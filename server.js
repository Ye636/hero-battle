// =====================================================
// 英雄知识大乱斗 —— WebSocket 服务端
// 功能：学生扫码直接加入（无需房间号）、上传头像昵称后自动均衡分组、
//       回合制答题（答对释放技能选目标攻击 / 答错全队扣血）、血量淘汰、排名结算
// =====================================================
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const { QUESTIONS } = require('./questions');

const PORT = parseInt(process.env.PORT) || 3000;
const TEAM_SIZE = parseInt(process.env.TEAM_SIZE) || 5; // 每队人数上限（默认4~5人一组），可配
const HOST_PASSWORD = process.env.HOST_PASSWORD || '666'; // 进入主持人模式的密码，可配
const ROUND_TIME_MS = parseInt(process.env.ROUND_TIME_MS) || 15000; // 每题作答倒计时(秒x1000)
const RESULT_DELAY_MS = parseInt(process.env.RESULT_DELAY_MS) || 4500; // 揭晓结果后到下一题的间隔
const PERSON_HP = parseInt(process.env.PERSON_HP) || 50;     // 每人基础血量（队伍HP = 人数 × 个人血量）
const WRONG_PENALTY = parseInt(process.env.WRONG_PENALTY) || 15; // 答错本队扣血（护盾不挡）
const FAST_RATIO = 0.4;   // 作答耗时 ≤ 限时40% 视为"快答"，奖励伤害/护盾

// ---------- 静态文件托管 ----------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};
const ROOT = __dirname;
const PUBLIC = path.join(__dirname, 'public');
const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  // 优先从 public/ 目录取文件；找不到再回退到仓库根目录（兼容 index.html 直接放根目录的部署）
  serve(rel, [path.resolve(PUBLIC, rel), path.resolve(ROOT, rel)], res);
});
function serve(rel, candidates, res) {
  if (!candidates.length) { res.writeHead(404); return res.end('Not found'); }
  const fp = candidates.shift();
  if (!fp.startsWith(PUBLIC) && !fp.startsWith(ROOT)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(fp, (err, data) => {
    if (err) return serve(rel, candidates, res);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
    res.end(data);
  });
}

const wss = new WebSocketServer({ server });

// ---------- 队伍 / 技能配置 ----------
const TEAM_POOL = [
  { name: '红队', color: '#ff4757', skill: { emoji: '🔥', name: '烈焰' } },
  { name: '蓝队', color: '#3498db', skill: { emoji: '💧', name: '寒冰' } },
  { name: '绿队', color: '#2ecc71', skill: { emoji: '🌿', name: '自然' } },
  { name: '金队', color: '#ffd700', skill: { emoji: '⚡', name: '雷霆' } },
  { name: '紫队', color: '#9b59b6', skill: { emoji: '🌌', name: '暗影' } },
  { name: '青队', color: '#00d2ff', skill: { emoji: '🌀', name: '旋风' } }
];
// 3 个角色（加入时自选）
//  warrior 战士：单发伤害最高，无连对加成
//  mage    法师：单发较低，每多连对一次额外加成
//  shield  盾牌手：不攻击，答对为全队加护盾减免下一次伤害
const PLAYER_SKILLS = [
  { key: 'warrior', emoji: '⚔️', name: '战士', color: '#e74c3c',
    desc: '单发伤害最高（45），但连对没有额外加成。适合稳扎稳打的主攻手。',
    base: 45, streak: 0, guard: 0 },
  { key: 'mage', emoji: '🔥', name: '法师', color: '#9b59b6',
    desc: '单发伤害较低（30），但每连对一次伤害 +10。越连对越恐怖，适合答题稳的核心。',
    base: 30, streak: 10, guard: 0 },
  { key: 'shield', emoji: '🛡️', name: '盾牌手', color: '#f1c40f',
    desc: '不攻击。答对时为全队加护盾（减免下一次技能伤害约 40%），连对会增强护盾。',
    base: 0, streak: 0, guard: 40 }
];

// ---------- 游戏状态 ----------
let nextId = 1;
const sockets = new Map(); // playerId -> ws
const state = {
  phase: 'lobby',  // lobby | playing | ended
  players: [],     // {id,name,photo,teamIdx,skill,score,correct,total}
  teams: [],       // {name,color,skill,hp,members:[ids],alive}
  hostId: null,
  curIdx: 0,       // 当前回合玩家在 players 中的下标
  qNum: 0,
  log: [],
  waiting: null,  // 'answer' | 'target' | null
  stats: {},       // 错题统计：qNum -> { qNum, q, asked, correct, wrongOptions }
  roundAnswers: {}, // 本轮玩家作答：playerId -> 选项下标
  roundTimer: null, // 本轮倒计时
  nextTimer: null,  // 揭晓后下一轮定时器
  roundStart: 0,    // 本轮出题时间戳
  answerTime: {},   // playerId -> 作答耗时ms
  shields: {}       // teamIdx -> {reduction}
};

// ---------- 辅助 ----------
function sendTo(id, obj) {
  const ws = sockets.get(id);
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
}
function broadcast(obj) {
  const str = JSON.stringify(obj);
  wss.clients.forEach(c => { if (c.readyState === 1) c.send(str); });
}
function sendHost(obj) {
  if (state.hostId != null) sendTo(state.hostId, obj);
}
function newTeam() {
  const i = state.teams.length;
  const base = TEAM_POOL[i % TEAM_POOL.length];
  const t = { name: base.name, color: base.color, skill: base.skill, hp: 0, maxHp: 0, members: [], alive: true };
  state.teams.push(t);
  return t;
}
// 自动分组：优先放入人数最少的未满队伍；至少保证有 2 支队伍（2 人及以上）
function pickTeam() {
  const prospectiveTotal = state.players.length + 1;
  if (prospectiveTotal >= 2 && state.teams.length < 2) return newTeam();
  let cand = state.teams
    .filter(t => t.members.length < TEAM_SIZE)
    .sort((a, b) => a.members.length - b.members.length)[0];
  if (!cand) cand = newTeam();
  return cand;
}
function teamOf(p) { return state.teams[p.teamIdx] || null; }
function teamAlive(idx) { return state.teams[idx] && state.teams[idx].alive; }
function aliveTeams() {
  return state.teams
    .map((t, idx) => ({ idx, name: t.name, color: t.color, hp: t.hp, alive: t.alive }))
    .filter(t => t.alive);
}
function playerFromId(id) { return state.players.find(p => p.id === id) || null; }

// 主持人视角状态
function hostState() {
  const aliveCount = state.teams.filter(t => t.alive && t.members.length > 0)
    .reduce((n, t) => n + t.members.length, 0);
  return {
    type: 'state_update',
    phase: state.phase,
    teams: state.teams.map((t, i) => ({
      idx: i, name: t.name, color: t.color, hp: t.hp, maxHp: t.maxHp || t.hp, alive: t.alive, skill: t.skill,
      shield: state.shields[i] ? state.shields[i].reduction : 0,
      members: t.members.map(id => {
        const p = playerFromId(id);
        return p ? { id: p.id, name: p.name, photo: p.photo, skill: p.skill, streak: p.streak || 0 } : null;
      }).filter(Boolean)
    })),
    currentQuestion: (state.phase === 'playing') ? {
      qNum: state.qNum + 1,
      q: QUESTIONS[state.qNum % QUESTIONS.length].q
    } : null,
    answered: aliveCount,
    log: state.log
  };
}

// 大厅状态（发给所有人，学生据此显示自己的队伍）
function lobbyUpdate() {
  return {
    type: 'lobby_update',
    phase: state.phase,
    players: state.players.map(p => ({ id: p.id, name: p.name, photo: p.photo, teamIdx: p.teamIdx })),
    teams: state.teams.map((t, i) => ({
      idx: i, name: t.name, color: t.color, skill: t.skill,
      members: t.members.map(id => {
        const p = playerFromId(id);
        return p ? { id: p.id, name: p.name, photo: p.photo, skill: p.skill } : null;
      }).filter(Boolean)
    }))
  };
}

// ---------- 同步回合控制（所有队伍同时作答、题目相同） ----------
let roundEvents = [];       // 本轮攻击事件（供动画）
let roundPerPlayer = {};    // 本轮每人对错
let roundCorrectPlayers = {}; // 本轮答对的人

function aliveMembers() {
  return state.teams
    .filter(t => t.alive && t.members.length > 0)
    .flatMap(t => t.members);
}

function startRound() {
  if (state.phase !== 'playing') return;
  state.qNum++;
  const q = QUESTIONS[state.qNum % QUESTIONS.length];
  state.roundAnswers = {};
  state.roundWrong = {};
  state.roundCorrect = {};
  state.roundCorrectPlayers = {};
  state.roundPerPlayer = {};
  state.answerTime = {};
  roundEvents = [];
  roundPerPlayer = {};
  roundCorrectPlayers = {};
  state.roundStart = Date.now();
  // 不足 2 支存活队伍 → 直接结算
  if (aliveTeams().length < 2) { endGame(); return; }
  broadcast({ type: 'round_question', qNum: state.qNum + 1, question: q.q, options: q.options, roundTime: ROUND_TIME_MS / 1000 });
  sendHost(hostState());
  clearTimeout(state.roundTimer);
  state.roundTimer = setTimeout(resolveRound, ROUND_TIME_MS);
}

function resolveRound() {
  clearTimeout(state.roundTimer);
  if (state.phase !== 'playing') return;
  const q = QUESTIONS[state.qNum % QUESTIONS.length];
  const st = (state.stats[state.qNum] = state.stats[state.qNum] || {
    qNum: state.qNum + 1, q: q.q, asked: 0, correct: 0, wrongOptions: {}
  });
  // 收集：统计每题/每人正确与错误
  state.players.forEach(p => {
    const a = state.roundAnswers[p.id];
    const answered = a !== undefined;
    const correct = answered && a === q.answer;
    st.asked++;
    if (correct) {
      st.correct++;
      p.correct++;
      p.score += 100;
      state.roundCorrect[p.teamIdx] = (state.roundCorrect[p.teamIdx] || 0) + 1;
      roundCorrectPlayers[p.id] = true;
    } else {
      state.roundWrong[p.teamIdx] = (state.roundWrong[p.teamIdx] || 0) + 1;
      if (answered && a >= 0) st.wrongOptions[a] = (st.wrongOptions[a] || 0) + 1;
    }
    roundPerPlayer[p.id] = { correct, answered, choiceIdx: answered ? a : null };
  });
  // 每个玩家根据自己的对错/快慢结算个人行动
  state.players.forEach(p => {
    const pp = roundPerPlayer[p.id];
    const t = state.teams[p.teamIdx];
    if (!t || !t.alive) return;
    if (!pp.correct) {
      // 答错：本队扣血（护盾不挡）
      p.streak = 0;
      damageTeam(t, WRONG_PENALTY, `${p.name} 答错，${t.name} -${WRONG_PENALTY}`);
      pp.action = { type: 'wrong', penalty: WRONG_PENALTY };
      return;
    }
    // 答对：连击 +1，依据角色行动
    p.streak = (p.streak || 0) + 1;
    const fast = (state.answerTime[p.id] || ROUND_TIME_MS) <= ROUND_TIME_MS * FAST_RATIO;
    const sk = p.skill;
    if (sk.key === 'warrior' || sk.key === 'mage') {
      // 攻击：自动打"本轮答错最多的存活敌方队"，无则随机
      let dmg = sk.base + (sk.streak || 0) * (p.streak - 1);
      if (fast) dmg += 8;
      const target = pickAttackTarget(p);
      if (target) {
        const final = teamDamage(target, dmg, p.teamIdx, p.name, sk.color, sk.emoji, sk.name);
        pp.action = { type: 'attack', targetName: target.name, damage: final, streak: p.streak, fast };
      } else {
        pp.action = { type: 'attack', targetName: '（无敌方）', damage: 0, streak: p.streak, fast };
      }
    } else if (sk.key === 'shield') {
      // 盾牌手：为全队加护盾（连对/快答增强）
      let reduction = sk.guard;
      if (p.streak >= 2) reduction += 5 * (p.streak - 1);
      if (fast) reduction += 8;
      reduction = Math.min(75, reduction);
      state.shields[p.teamIdx] = { reduction };
      state.log.push({ text: `🛡️ ${p.name}（盾牌手）为 ${t.name} 加盾，减免 ${reduction}%`, type: 'hero' });
      roundEvents.push({ shieldFor: p.teamIdx, reduction, fromName: p.name, fromEmoji: sk.emoji, teamName: t.name });
      pp.action = { type: 'shield', reduction, streak: p.streak, fast };
    }
  });
  finishRound();
}

// 选攻击目标：优先本轮答错最多的存活敌队，无则随机
function pickAttackSource(teamIdx) {
  const list = state.teams.map((t, idx) => ({ t, idx })).filter(o => o.t.alive && o.t.members.length > 0 && o.idx !== teamIdx);
  if (!list.length) return null;
  const maxWrong = Math.max(...list.map(o => state.roundWrong[o.idx] || 0));
  if (maxWrong > 0) return list.find(o => (state.roundWrong[o.idx] || 0) === maxWrong).t;
  return list[Math.floor(Math.random() * list.length)].t;
}
function pickAttackTarget(p) { return pickAttackSource(p.teamIdx); }

function finishRound() {
  const q = QUESTIONS[state.qNum % QUESTIONS.length];
  const teamsSnap = state.teams.map((t, i) => ({ idx: i, name: t.name, color: t.color, hp: t.hp, maxHp: t.maxHp || t.hp, alive: t.alive }));
  state.players.forEach(p => {
    const pp = roundPerPlayer[p.id] || { correct: false, answered: false, choiceIdx: null };
    sendTo(p.id, {
      type: 'round_result', qNum: state.qNum + 1, correct: pp.correct,
      answer: q.options[q.answer], explain: q.explain,
      action: pp.action || null, streak: p.streak || 0,
      teams: teamsSnap, events: roundEvents, teamName: teamOf(p) ? teamOf(p).name : ''
    });
  });
  sendHost(hostState());
  if (checkEnd()) return;
  clearTimeout(state.nextTimer);
  state.nextTimer = setTimeout(startRound, RESULT_DELAY_MS);
}

// 普通伤害（答错惩罚，护盾无效）
function damageTeam(t, dmg, logText) {
  t.hp -= dmg;
  state.log.push({ text: logText, type: 'bad' });
  t.members.forEach(id => sendTo(id, { type: 'damage_taken' }));
  if (t.hp <= 0) {
    t.hp = 0;
    t.alive = false;
    state.log.push({ text: `💀 ${t.name} 被击败！`, type: 'bad' });
  }
}

// 技能伤害（可被护盾减免，并消耗护盾）
function teamDamage(t, dmg, fromIdx, fromName, fromColor, fromEmoji) {
  const ti = state.teams.indexOf(t);
  let final = dmg;
  let shielded = false;
  const sh = state.shields[ti];
  if (sh && t.alive) {
    final = Math.max(1, Math.round(dmg * (1 - sh.reduction / 100)));
    shielded = true;
    delete state.shields[ti];
    state.log.push({ text: `🛡️ ${t.name} 的护盾抵挡了部分伤害（减免 ${sh.reduction}%）`, type: 'hero' });
  }
  t.hp -= final;
  state.log.push({ text: `${fromEmoji} ${fromName} 对 ${t.name} 造成 ${final} 伤害${shielded ? '（被护盾减免）' : ''}`, type: 'skill' });
  t.members.forEach(id => sendTo(id, { type: 'damage_taken' }));
  if (t.hp <= 0) { t.hp = 0; t.alive = false; state.log.push({ text: `💀 ${t.name} 被击败！`, type: 'bad' }); }
  roundEvents.push({
    fromTeam: fromIdx, fromName, fromColor, fromEmoji,
    toTeam: ti, toName: t.name, toColor: t.color, damage: final, shielded
  });
  return final;
}

function checkEnd() {
  const alive = state.teams.filter(t => t.alive && t.members.length > 0);
  if (alive.length <= 1) { endGame(); return true; }
  return false;
}

// 汇总错题统计（按答错次数从高到低）
function buildStats() {
  return Object.values(state.stats)
    .map(s => {
      const wrong = s.asked - s.correct;
      return {
        qNum: s.qNum, q: s.q, asked: s.asked, correct: s.correct, wrong,
        wrongList: Object.keys(s.wrongOptions)
          .map(k => ({ idx: +k, count: s.wrongOptions[k] }))
          .sort((a, b) => b.count - a.count)
      };
    })
    .sort((a, b) => b.wrong - a.wrong);
}

function endGame() {
  state.phase = 'ended';
  state.waiting = null;
  clearTimeout(state.roundTimer);
  clearTimeout(state.nextTimer);
  const ranking = state.players
    .slice()
    .sort((a, b) => b.score - a.score || a.total - b.total)
    .map(p => ({
      name: p.name, photo: p.photo, score: p.score, correct: p.correct, total: p.total,
      teamName: teamOf(p) ? teamOf(p).name : '', skill: p.skill
    }));
  broadcast({ type: 'game_end', ranking });
  sendHost({ type: 'answer_stats', stats: buildStats() });
  sendHost(hostState());
}

// ---------- 消息处理 ----------
function handleMsg(ws, msg) {
  switch (msg.type) {
    case 'host_init': {
      // 校验主持人密码，防止学生误入/绕过
      if (msg.password !== HOST_PASSWORD) {
        sendTo(ws.__id, { type: 'host_rejected', msg: '密码错误，无法进入主持人模式' });
        return;
      }
      // 若上一局已结束，进入时自动回到新大厅，方便主持人直接开始下一局
      if (state.phase === 'ended') {
        state.phase = 'lobby';
        state.teams.forEach(t => {
          t.maxHp = t.members.length * PERSON_HP;
          t.hp = t.maxHp;
          t.alive = t.members.length > 0;
        });
        state.players.forEach(p => { p.score = 0; p.correct = 0; p.total = 0; p.streak = 0; });
        state.qNum = -1;
        state.curIdx = 0;
        state.log = [];
        state.stats = {};
        state.roundAnswers = {};
        state.shields = {};
        clearTimeout(state.roundTimer);
        clearTimeout(state.nextTimer);
        state.waiting = null;
      }
      state.hostId = ws.__id;
      sendHost(lobbyUpdate());
      sendHost(hostState());
      break;
    }
    case 'join': {
      if (state.phase !== 'lobby') {
        sendTo(ws.__id, { type: 'error', msg: '游戏已开始，无法加入' });
        return;
      }
      const name = (msg.name || '').toString().trim().slice(0, 12);
      if (!name) { sendTo(ws.__id, { type: 'error', msg: '请输入昵称' }); return; }
      const photo = (typeof msg.photo === 'string' && msg.photo.length < 300000) ? msg.photo : null;
      const team = pickTeam();
      let skill = PLAYER_SKILLS.find(s => s.key === msg.skillKey);
      if (!skill) skill = PLAYER_SKILLS[0]; // 默认战士
      const player = {
        id: ws.__id, name, photo, teamIdx: state.teams.indexOf(team),
        skill, streak: 0, score: 0, correct: 0, total: 0
      };
      state.players.push(player);
      team.members.push(player.id);
      sendTo(player.id, {
        type: 'joined',
        playerId: player.id,
        team: { name: team.name, color: team.color, skill: team.skill }
      });
      broadcast(lobbyUpdate());
      sendHost(hostState());
      break;
    }
    case 'start_game': {
      if (ws.__id !== state.hostId) { sendTo(ws.__id, { type: 'error', msg: '只有主持人能开始游戏' }); return; }
      if (state.phase !== 'lobby') return;
      // 主持人随时可开始：只要有玩家在场即可（人数不足时仍可开始）
      if (state.players.length < 1) { sendTo(ws.__id, { type: 'error', msg: '还没有玩家加入，稍等片刻' }); return; }
      // 队伍HP = 队人数 × PERSON_HP（人多人血厚、人少人血少，保持公平）
      state.teams.forEach(t => {
        t.maxHp = t.members.length * PERSON_HP;
        t.hp = t.maxHp;
        t.alive = t.members.length > 0;
      });
      state.players.forEach(p => { p.streak = 0; });
      state.phase = 'playing';
      state.qNum = -1; // 首题为第 1 题
      state.curIdx = 0;
      state.log = [];
      state.stats = {};
      state.roundAnswers = {};
      state.shields = {};
      clearTimeout(state.roundTimer);
      clearTimeout(state.nextTimer);
      state.log.push({ text: '⚔️ 战斗开始！', type: 'skill' });
      broadcast({ type: 'game_started' });
      broadcast(lobbyUpdate());
      // 若存活队伍不足 2 支（如只有 1 人/1 队），直接结束，该队即为冠军
      if (aliveTeams().length < 2) { endGame(); return; }
      startRound();
      break;
    }
    case 'answer': {
      if (state.phase !== 'playing') return;
      const p = playerFromId(ws.__id);
      if (!p) return;
      if (state.roundAnswers[p.id] !== undefined) return; // 已作答，忽略重复
      const q = QUESTIONS[state.qNum % QUESTIONS.length];
      const chosenIdx = q.options.indexOf(msg.choice);
      if (chosenIdx < 0) return;
      state.roundAnswers[p.id] = chosenIdx;
      state.answerTime[p.id] = state.roundStart ? Date.now() - state.roundStart : 0;
      // 全员都已作答 → 提前结算
      const unanswered = aliveMembers().filter(id => state.roundAnswers[id] === undefined);
      if (unanswered.length === 0 && state.roundTimer) {
        clearTimeout(state.roundTimer);
        resolveRound();
      }
      break;
    }
    case 'reset_game': {
      // 主持人点"再来一局"：重置到大厅，保留在线玩家与分组，可无限次开战
      if (ws.__id !== state.hostId) { sendTo(ws.__id, { type: 'error', msg: '只有主持人能重置游戏' }); return; }
      state.phase = 'lobby';
      state.teams.forEach(t => {
        t.maxHp = t.members.length * PERSON_HP;
        t.hp = t.maxHp;
        t.alive = t.members.length > 0;
      });
      state.players.forEach(p => { p.score = 0; p.correct = 0; p.total = 0; p.streak = 0; });
      state.curIdx = 0;
      state.qNum = -1; // 首题为第 1 题
      state.log = [];
      state.stats = {};
      state.roundAnswers = {};
      state.shields = {};
      clearTimeout(state.roundTimer);
      clearTimeout(state.nextTimer);
      state.waiting = null;
      broadcast({ type: 'game_reset' });
      broadcast(lobbyUpdate());
      sendHost(hostState());
      break;
    }
    default:
      break;
  }
}

// ---------- 连接管理 ----------
wss.on('connection', (ws) => {
  const id = nextId++;
  ws.__id = id;
  sockets.set(id, ws);

  // 新进页面默认展示大厅状态（非主持人也会收到，用于显示自己的队伍）
  sendTo(id, lobbyUpdate());

  ws.on('message', (data) => {
    try { handleMsg(ws, JSON.parse(data.toString())); }
    catch (e) { console.error('bad message', e.message); }
  });

  ws.on('close', () => {
    sockets.delete(id);
    // 清理已断开玩家
    const p = playerFromId(id);
    if (p) {
      const t = teamOf(p);
      if (t) {
        t.members = t.members.filter(mid => mid !== id);
        if (t.members.length === 0) t.alive = false;
      }
      state.players = state.players.filter(x => x.id !== id);
      delete state.roundAnswers[id];
    }
    if (state.hostId === id) state.hostId = null;
    // 对局中有人断开：若本轮存活者已全部作答，则提前结算
    if (state.phase === 'playing' && state.roundTimer) {
      const unanswered = aliveMembers().filter(mid => state.roundAnswers[mid] === undefined);
      if (unanswered.length === 0) {
        clearTimeout(state.roundTimer);
        resolveRound();
      }
    }
    broadcast(lobbyUpdate());
    sendHost(hostState());
  });
});

server.listen(PORT, () => {
  console.log(`[Hero Battle] Server running at http://localhost:${PORT}`);
  console.log(`  Team size cap : ${TEAM_SIZE} (override with env TEAM_SIZE)`);
  console.log(`  Question count: ${QUESTIONS.length}`);
});

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
const RESULT_DELAY_MS = parseInt(process.env.RESULT_DELAY_MS) || 6000; // 揭晓后冷却6秒再下一题
const PERSON_HP = parseInt(process.env.PERSON_HP) || 300;     // 每人基础血量（队伍HP = 人数 × 个人血量），调高以撑完所有题
const WRONG_PENALTY = parseInt(process.env.WRONG_PENALTY) || 5;  // 答错本队扣血（护盾不挡）
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
    desc: '单发伤害较高（25），但连对没有额外加成。适合稳扎稳打的主攻手。',
    base: 25, streak: 0, guard: 0 },
  { key: 'mage', emoji: '🔥', name: '法师', color: '#9b59b6',
    desc: '单发较低（15），但每连对一次伤害 +5。越连对越恐怖，适合答题稳的核心。',
    base: 15, streak: 5, guard: 0 },
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
  shields: {},      // teamIdx -> {reduction}
  roundTargetChoice: {} // playerId -> 自选攻击目标 teamIdx
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
// 自动分组：按进入顺序轮转 → 第1个红队、第2个蓝队、第3个黄队、第4个绿队、第5个红队…满5人跳下一队
function pickTeam() {
  let n = state.players.length; // 当前已有 n 人，即将加入第 n+1 个
  // 还没建满 4 个队时，每来一人开新队（红/蓝/黄/绿）
  if (state.teams.length === 0) return newTeam();
  if (n < state.teams.length) return newTeam();
  // 已有4队 → 按 n 轮转，找第一个未满5人的队
  for (let i = 0; i < state.teams.length; i++) {
    const t = state.teams[(n + i) % state.teams.length];
    if (t.members.length < TEAM_SIZE) return t;
  }
  return newTeam();
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

// ---------- 独立答题模式：每人各自进度，答完立即下一题 ----------
// 给玩家发下一题（p.qNum 自增）
function sendQuestion(p) {
  if (state.phase !== 'playing') return;
  p.qNum++;
  if (p.qNum >= QUESTIONS.length) {
    // 该玩家已答完所有题
    p.done = true;
    sendTo(p.id, { type: 'player_done' });
    sendHost(hostState());
    checkAllDone();
    return;
  }
  const q = QUESTIONS[p.qNum % QUESTIONS.length];
  p.answerStart = Date.now();
  p.picked = false;
  p.answered = false; // 允许答下一题
  p.pendingTarget = false;
  sendTo(p.id, {
    type: 'player_question', qNum: p.qNum + 1, total: QUESTIONS.length,
    question: q.q, img: q.img, options: q.options,
    roundTime: ROUND_TIME_MS / 1000
  });
  sendHost(hostState());
}

// 所有人都答完 → 结算
function checkAllDone() {
  const active = state.players.filter(p => !p.done);
  if (active.length === 0) endGame();
}

// 玩家答完一题后的通用结算
function advanceAfterAction(p, result) {
  const q = QUESTIONS[p.qNum % QUESTIONS.length];
  sendTo(p.id, {
    type: 'action_result', correct: result.correct, answer: q.options[q.answer],
    explain: q.explain, action: result.action || null, streak: p.streak || 0,
    teams: teamsSnapshot()
  });
  // 错了 → 冷却6秒再下一题；对了 → 立即下一题
  if (!result.correct) {
    setTimeout(() => sendQuestion(p), RESULT_DELAY_MS);
  } else {
    sendQuestion(p);
  }
}

function teamsSnapshot() {
  return state.teams.map((t, i) => ({
    idx: i, name: t.name, color: t.color, hp: t.hp, maxHp: t.maxHp || t.hp, alive: t.alive
  }));
}

// 选攻击目标：随机存活敌队
function pickRandomEnemy(teamIdx) {
  const list = state.teams.map((t, idx) => ({ t, idx })).filter(o => o.t.alive && o.t.members.length > 0 && o.idx !== teamIdx);
  if (!list.length) return null;
  return list[Math.floor(Math.random() * list.length)].t;
}

// 答对后执行角色行动（攻击/加盾），返回 action 对象
function applyAction(p, fast, targetIdx) {
  const sk = p.skill;
  const t = teamOf(p);
  if (sk.key === 'warrior' || sk.key === 'mage') {
    let dmg = sk.base + (sk.streak || 0) * ((p.streak || 1) - 1);
    if (fast) dmg += 8;
    let target = null;
    if (targetIdx != null && state.teams[targetIdx] && state.teams[targetIdx].alive) {
      target = state.teams[targetIdx];
    } else {
      target = pickRandomEnemy(p.teamIdx);
    }
    if (target) {
      const final = teamDamage(target, dmg, p.teamIdx, p.name, sk.color, sk.emoji, sk.name);
      return { type: 'attack', targetName: target.name, damage: final, streak: p.streak, fast };
    }
    return { type: 'attack', targetName: '（无敌方）', damage: 0, streak: p.streak, fast };
  } else if (sk.key === 'shield') {
    let reduction = sk.guard;
    if (p.streak >= 2) reduction += 5 * (p.streak - 1);
    if (fast) reduction += 8;
    reduction = Math.min(75, reduction);
    state.shields[p.teamIdx] = { reduction };
    state.log.push({ text: `🛡️ ${p.name}（盾牌手）为 ${t ? t.name : '本队'} 加盾，减免 ${reduction}%`, type: 'hero' });
    return { type: 'shield', reduction, streak: p.streak, fast };
  }
  return null;
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
  // 队伍按剩余血量排名，血最多的队获胜
  const teamRank = state.teams.slice().sort((a, b) => b.hp - a.hp).map(t => ({
    name: t.name, color: t.color, hp: Math.max(0, t.hp), maxHp: t.maxHp, members: t.members.length
  }));
  const ranking = state.players
    .slice()
    .sort((a, b) => (b.correct || 0) - (a.correct || 0))
    .map(p => ({
      name: p.name, photo: p.photo, correct: p.correct, total: QUESTIONS.length,
      teamName: teamOf(p) ? teamOf(p).name : '', skill: p.skill
    }));
  broadcast({ type: 'game_end', teamRank, ranking });
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
      if (state.players.length < 1) { sendTo(ws.__id, { type: 'error', msg: '还没有玩家加入，稍等片刻' }); return; }
      state.teams.forEach(t => {
        t.maxHp = t.members.length * PERSON_HP;
        t.hp = t.maxHp;
        t.alive = t.members.length > 0;
      });
      state.players.forEach(p => { p.streak = 0; p.qNum = -1; p.done = false; p.answerStart = 0; });
      state.phase = 'playing';
      state.log = [];
      state.stats = {};
      state.shields = {};
      clearTimeout(state.roundTimer);
      clearTimeout(state.nextTimer);
      state.log.push({ text: '⚔️ 战斗开始！每人独立答题，答得快且对可自选目标攻击！', type: 'skill' });
      broadcast({ type: 'game_started' });
      broadcast(lobbyUpdate());
      // 给每个玩家发第一题（即使只有1队也能跑，攻击无目标时自动跳过）
      state.players.forEach(p => sendQuestion(p));
      break;
    }
    case 'answer': {
      if (state.phase !== 'playing') return;
      const p = playerFromId(ws.__id);
      if (!p || p.done || p.answered) return;
      const q = QUESTIONS[p.qNum % QUESTIONS.length];
      const chosenIdx = q.options.indexOf(msg.choice);
      if (chosenIdx < 0) return;
      p.answered = true;
      const correct = chosenIdx === q.answer;
      const elapsed = Date.now() - (p.answerStart || Date.now());
      const fast = elapsed <= ROUND_TIME_MS * FAST_RATIO;
      const t = teamOf(p);
      // 统计
      const st = (state.stats[p.qNum] = state.stats[p.qNum] || { qNum: p.qNum + 1, q: q.q, asked: 0, correct: 0, wrongOptions: {} });
      st.asked++;
      if (!correct) {
        st.wrongOptions[chosenIdx] = (st.wrongOptions[chosenIdx] || 0) + 1;
        p.streak = 0;
        if (t && t.alive) damageTeam(t, WRONG_PENALTY, `${p.name} 答错，${t.name} -${WRONG_PENALTY}`);
        sendHost(hostState());
        advanceAfterAction(p, { correct: false, action: { type: 'wrong', penalty: WRONG_PENALTY } });
      } else {
        st.correct++;
        p.correct = (p.correct || 0) + 1;
        p.streak = (p.streak || 0) + 1;
        const sk = p.skill;
        // 答对：攻击手若快答 → 选目标；慢答或盾牌手 → 立即结算
        if ((sk.key === 'warrior' || sk.key === 'mage') && fast) {
          const enemies = state.teams.map((tt, idx) => ({ idx, name: tt.name, color: tt.color, alive: tt.alive }))
            .filter(o => o.alive && o.idx !== p.teamIdx);
          if (enemies.length) {
            p.pendingTarget = true;
            sendTo(p.id, { type: 'pick_target', enemies });
            return; // 等 attack_target 再结算
          }
        }
        // 自动结算（慢答攻击手/盾牌手）
        const act = applyAction(p, fast, null);
        sendHost(hostState());
        advanceAfterAction(p, { correct: true, action: act });
      }
      break;
    }
    case 'attack_target': {
      if (state.phase !== 'playing') return;
      const p = playerFromId(ws.__id);
      if (!p || !p.pendingTarget || p.done) return;
      p.pendingTarget = false;
      const fast = true; // 选目标的都是快答对
      const act = applyAction(p, fast, msg.targetIdx);
      sendHost(hostState());
      advanceAfterAction(p, { correct: true, action: act });
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

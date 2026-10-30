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
const STRATEGY_TIME_MS = parseInt(process.env.STRATEGY_TIME_MS) || 8000; // 先手权选择进攻/防御的投票时间
const BASE_ATTACK = 30;          // 队伍技能基础伤害
const SHIELD_BASE = 50;          // 防御护盾基础减免百分比
const SHIELD_MAX = 80;           // 护盾减免上限百分比

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
const PLAYER_SKILLS = [
  { emoji: '⚔️', name: '剑士', color: '#ff6b6b', power: 30, guard: 0 },
  { emoji: '🏹', name: '射手', color: '#f39c12', power: 35, guard: 0 },
  { emoji: '🛡️', name: '盾牌手', color: '#f1c40f', power: 15, guard: 20 },
  { emoji: '🧙', name: '法师', color: '#9b59b6', power: 40, guard: 0 },
  { emoji: '🥷', name: '忍者', color: '#2ecc71', power: 30, guard: 0 },
  { emoji: '🦸', name: '战士', color: '#e74c3c', power: 35, guard: 0 },
  { emoji: '🧝', name: '精灵', color: '#1abc9c', power: 25, guard: 0 },
  { emoji: '🤖', name: '机甲', color: '#95a5a6', power: 40, guard: 0 }
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
  strategy: null,   // 先手权投票：{ teamIdx, votes:{id:..}, timer, targets:{} }
  strategyTimer: null
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
  const t = { name: base.name, color: base.color, skill: base.skill, hp: 300, members: [], alive: true };
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
      idx: i, name: t.name, color: t.color, hp: t.hp, alive: t.alive, skill: t.skill,
      shield: state.shields[i] ? state.shields[i].reduction : 0,
      members: t.members.map(id => {
        const p = playerFromId(id);
        return p ? { id: p.id, name: p.name, photo: p.photo, skill: p.skill } : null;
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
  // 阶段1：答错/超时的玩家所属队伍扣血（无法被护盾抵挡）
  state.players.forEach(p => {
    const t = state.teams[p.teamIdx];
    if (!t || !t.alive) return;
    if (!roundPerPlayer[p.id].correct) damageTeam(t, 25, `${p.name} 答错，${t.name} 全队受到 25 伤害`);
  });
  // 阶段2：先手权 —— 本轮答得快且正确率最高的队伍，可选进攻或防御
  const ini = computeBestTeam();
  if (ini && (state.roundCorrect[ini.idx] || 0) > 0) {
    startStrategy(ini.idx);
  } else {
    applyAttacks(-1);
    finishRound();
  }
}

// 队伍成员本轮答对者的技能伤害总和
function teamPowerSum(teamIdx) {
  const t = state.teams[teamIdx];
  if (!t) return 0;
  return t.members.reduce((s, id) => {
    const p = playerFromId(id);
    return s + (roundCorrectPlayers[id] ? (p ? p.skill.power : 0) : 0);
  }, 0);
}
// 队伍成员本轮答对者的护盾加成总和
function teamGuardSum(teamIdx) {
  const t = state.teams[teamIdx];
  if (!t) return 0;
  return t.members.reduce((s, id) => {
    const p = playerFromId(id);
    return s + (roundCorrectPlayers[id] ? (p ? p.skill.guard : 0) : 0);
  }, 0);
}
// 本轮最佳队伍（正确数优先、作答快者优先）
function computeBestTeam() {
  const list = state.teams.map((t, idx) => ({ t, idx })).filter(o => o.t.alive && o.t.members.length > 0);
  const results = [];
  list.forEach(o => {
    const answered = o.t.members.filter(id => state.roundAnswers[id] !== undefined);
    if (!answered.length) return;
    const avgTime = answered.reduce((s, id) => s + (state.answerTime[id] || ROUND_TIME_MS), 0) / answered.length;
    let speed = 0;
    const ratio = avgTime / ROUND_TIME_MS;
    if (ratio <= 0.4) speed = 80;
    else if (ratio <= 0.7) speed = 40;
    results.push({ idx: o.idx, perf: (state.roundCorrect[o.idx] || 0) * 100 + speed, avgTime });
  });
  if (!results.length) return null;
  results.sort((a, b) => b.perf - a.perf || a.avgTime - b.avgTime);
  return results[0];
}

// ---------- 先手权投票（进攻 / 防御） ----------
function startStrategy(teamIdx) {
  const t = state.teams[teamIdx];
  const enemies = aliveTeams().filter(x => x.idx !== teamIdx);
  if (!enemies.length) { applyAttacks(teamIdx); finishRound(); return; }
  state.strategy = { teamIdx, votes: {}, targets: {} };
  clearTimeout(state.strategyTimer);
  state.strategyTimer = setTimeout(endStrategy, STRATEGY_TIME_MS);
  t.members.forEach(id => {
    const p = playerFromId(id);
    if (p) sendTo(id, { type: 'strategy_prompt', teamName: t.name, teamColor: t.color, enemies });
  });
  state.players.forEach(p => { if (p.teamIdx !== teamIdx) sendTo(p.id, { type: 'strategy_waiting', teamName: t.name }); });
  sendHost(hostState());
}

function endStrategy() {
  clearTimeout(state.strategyTimer);
  if (!state.strategy) return;
  const st = state.strategy;
  const teamIdx = st.teamIdx;
  state.strategy = null;
  const t = state.teams[teamIdx];
  if (!t || !t.alive) { applyAttacks(-1); finishRound(); return; }
  const votes = Object.values(st.votes);
  const attackN = votes.filter(v => v === 'attack').length;
  const defendN = votes.length - attackN;
  if (defendN >= attackN) {
    // 🛡️ 防御：给本队套护盾（盾牌手答对可提升减免）
    const reduction = Math.min(SHIELD_MAX, SHIELD_BASE + teamGuardSum(teamIdx));
    state.shields[teamIdx] = { reduction };
    state.log.push({ text: `🛡️ ${t.name} 选择防御，护盾减免 ${reduction}% 下一次技能伤害`, type: 'hero' });
    t.members.forEach(id => sendTo(id, { type: 'strategy_result', action: 'defend', reduction }));
    broadcast({ type: 'shield_up', teamIdx, teamName: t.name, color: t.color, reduction });
  } else {
    // 🗡️ 进攻：选多数目标
    const enemies = aliveTeams().filter(x => x.idx !== teamIdx);
    const targetCounts = {};
    Object.values(st.targets).forEach(ti => { targetCounts[ti] = (targetCounts[ti] || 0) + 1; });
    let target = null;
    if (Object.keys(targetCounts).length) {
      const maxN = Math.max(...Object.values(targetCounts));
      target = state.teams[+Object.keys(targetCounts).find(k => targetCounts[k] === maxN)];
    }
    if (!target || !target.alive) target = state.teams[enemies[Math.floor(Math.random() * enemies.length)].idx];
    const dmg = BASE_ATTACK + teamPowerSum(teamIdx);
    teamDamage(target, dmg, teamIdx, t.name, t.color, t.skill.emoji);
    t.members.forEach(id => sendTo(id, { type: 'strategy_result', action: 'attack', targetName: target.name, damage: dmg }));
  }
  applyAttacks(teamIdx);
  finishRound();
}

// 其余答对队伍自动攻击"本轮答错最多的存活敌方队伍"（无则随机）
function applyAttacks(initIdx) {
  const aliveList = state.teams.map((t, idx) => ({ t, idx })).filter(o => o.t.alive && o.t.members.length > 0);
  state.teams.forEach((t, idx) => {
    if (idx === initIdx) return;
    if (!t.alive || !t.members.length) return;
    const cc = state.roundCorrect[idx] || 0;
    if (cc <= 0) return;
    const enemies = aliveList.filter(o => o.idx !== idx);
    if (!enemies.length) return;
    let target;
    const maxWrong = Math.max(...enemies.map(o => state.roundWrong[o.idx] || 0));
    if (maxWrong > 0) target = enemies.find(o => (state.roundWrong[o.idx] || 0) === maxWrong);
    else target = enemies[Math.floor(Math.random() * enemies.length)];
    const dmg = BASE_ATTACK + teamPowerSum(idx);
    teamDamage(target.t, dmg, idx, t.name, t.color, t.skill.emoji);
  });
}

function finishRound() {
  const q = QUESTIONS[state.qNum % QUESTIONS.length];
  const teamsSnap = state.teams.map((t, i) => ({ idx: i, name: t.name, color: t.color, hp: t.hp, alive: t.alive }));
  state.players.forEach(p => {
    const pp = roundPerPlayer[p.id] || { correct: false, answered: false, choiceIdx: null };
    sendTo(p.id, {
      type: 'round_result', qNum: state.qNum + 1, correct: pp.correct,
      answer: q.options[q.answer], explain: q.explain,
      damageToMe: pp.correct ? 0 : 25, teams: teamsSnap, events: roundEvents, teamName: teamOf(p) ? teamOf(p).name : ''
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
  state.strategy = null;
  clearTimeout(state.roundTimer);
  clearTimeout(state.nextTimer);
  clearTimeout(state.strategyTimer);
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
        state.teams.forEach(t => { t.hp = 300; t.alive = t.members.length > 0; });
        state.players.forEach(p => { p.score = 0; p.correct = 0; p.total = 0; });
        state.qNum = -1;
        state.curIdx = 0;
        state.log = [];
        state.stats = {};
        state.roundAnswers = {};
        state.shields = {};
        state.strategy = null;
        clearTimeout(state.roundTimer);
        clearTimeout(state.nextTimer);
        clearTimeout(state.strategyTimer);
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
      const skill = PLAYER_SKILLS[Math.floor(Math.random() * PLAYER_SKILLS.length)];
      const player = {
        id: ws.__id, name, photo, teamIdx: state.teams.indexOf(team),
        skill, score: 0, correct: 0, total: 0
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
      state.teams.forEach(t => { t.hp = 300; t.alive = t.members.length > 0; });
      state.phase = 'playing';
      state.qNum = -1; // 首题为第 1 题
      state.curIdx = 0;
      state.log = [];
      state.stats = {};
      state.roundAnswers = {};
      state.shields = {};
      state.strategy = null;
      clearTimeout(state.roundTimer);
      clearTimeout(state.nextTimer);
      clearTimeout(state.strategyTimer);
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
    case 'strategy': {
      // 先手队伍成员投票：进攻(选目标) 或 防御
      if (state.phase !== 'playing' || !state.strategy) return;
      const p = playerFromId(ws.__id);
      if (!p || p.teamIdx !== state.strategy.teamIdx) return;
      if (state.strategy.votes[p.id]) return;
      state.strategy.votes[p.id] = msg.action === 'attack' ? 'attack' : 'defend';
      if (msg.action === 'attack' && typeof msg.targetIdx === 'number') state.strategy.targets[p.id] = msg.targetIdx;
      const members = state.teams[state.strategy.teamIdx].members;
      if (members.every(id => state.strategy.votes[id] !== undefined)) endStrategy();
      break;
    }
    case 'reset_game': {
      // 主持人点"再来一局"：重置到大厅，保留在线玩家与分组，可无限次开战
      if (ws.__id !== state.hostId) { sendTo(ws.__id, { type: 'error', msg: '只有主持人能重置游戏' }); return; }
      state.phase = 'lobby';
      state.teams.forEach(t => { t.hp = 300; t.alive = t.members.length > 0; });
      state.players.forEach(p => { p.score = 0; p.correct = 0; p.total = 0; });
      state.curIdx = 0;
      state.qNum = -1; // 首题为第 1 题
      state.log = [];
      state.stats = {};
      state.roundAnswers = {};
      state.shields = {};
      state.strategy = null;
      clearTimeout(state.roundTimer);
      clearTimeout(state.nextTimer);
      clearTimeout(state.strategyTimer);
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
    // 先手权投票中有人断开：若先手队剩余成员均已投票，则结束投票
    if (state.phase === 'playing' && state.strategy) {
      const team = state.teams[state.strategy.teamIdx];
      if (team && team.members.every(mid => state.strategy.votes[mid] !== undefined)) endStrategy();
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

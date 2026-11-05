// =====================================================
// 英雄知识大乱斗 —— 题库（英文释义选择题，每题配 emoji 图）
// 每题: { q(英文释义), img(emoji配图), options(英文单词), answer, explain }
// =====================================================
const QUESTIONS = [
  {
    q: 'A strong desire to learn or know something.',
    img: '🤔',
    options: ['creativity', 'curiosity', 'authenticity', 'clarity'],
    answer: 1,
    explain: 'curiosity = 好奇心（a desire to learn/know）'
  },
  {
    q: 'The ability to invent or make new and original things.',
    img: '💡',
    options: ['curiosity', 'mentality', 'creativity', 'humidity'],
    answer: 2,
    explain: 'creativity = 创造力'
  },
  {
    q: 'Being real or genuine, not copied or fake.',
    img: '🎭',
    options: ['possibility', 'authenticity', 'necessity', 'civility'],
    answer: 1,
    explain: 'authenticity = 真实性、真伪'
  },
  {
    q: 'The quality of being clear and easy to understand.',
    img: '🔍',
    options: ['intensity', 'humidity', 'mentality', 'clarity'],
    answer: 3,
    explain: 'clarity = 清晰（clear 的名词形式，不规则变化）'
  },
  {
    q: 'A chance that something may happen or be true.',
    img: '🌱',
    options: ['necessity', 'possibility', 'authenticity', 'curiosity'],
    answer: 1,
    explain: 'possibility = 可能性（possible 的名词）'
  },
  {
    q: 'Something that you must have or must do.',
    img: '⚙️',
    options: ['possibility', 'intensity', 'necessity', 'civility'],
    answer: 2,
    explain: 'necessity = 必需品、必要（necessary 的名词，不规则变化）'
  },
  {
    q: 'The amount of water vapor in the air.',
    img: '💧',
    options: ['clarity', 'humidity', 'mentality', 'curiosity'],
    answer: 1,
    explain: 'humidity = 湿度（humid 的名词）'
  },
  {
    q: "A person's way of thinking or their mental attitude.",
    img: '🧠',
    options: ['creativity', 'intensity', 'mentality', 'authenticity'],
    answer: 2,
    explain: 'mentality = 心态、思维方式'
  },
  {
    q: 'The strength or degree of something, often very strong.',
    img: '🔥',
    options: ['humidity', 'clarity', 'possibility', 'intensity'],
    answer: 3,
    explain: 'intensity = 强度（intense 的名词）'
  },
  {
    q: 'Polite, calm and respectful behaviour towards others.',
    img: '🤝',
    options: ['necessity', 'civility', 'mentality', 'curiosity'],
    answer: 1,
    explain: 'civility = 礼貌、文明（civil 的名词）'
  },
  {
    q: 'The reason or drive that makes you want to do something.',
    img: '🚀',
    options: ['mission', 'motivation', 'boundary', 'thrill'],
    answer: 1,
    explain: 'motivation = 动力、动机'
  },
  {
    q: 'A sudden feeling of excitement and pleasure.',
    img: '🎢',
    options: ['endurance', 'thrill', 'network', 'settlement'],
    answer: 1,
    explain: 'thrill = 刺激、兴奋'
  },
  {
    q: 'A place where people come to live and make their homes.',
    img: '🏠',
    options: ['mission', 'hypothesis', 'settlement', 'boundary'],
    answer: 2,
    explain: 'settlement = 定居点'
  },
  {
    q: 'A system of connected people, routes or things.',
    img: '🕸️',
    options: ['trek', 'network', 'launch', 'seek'],
    answer: 1,
    explain: 'network = 网络'
  },
  {
    q: 'A long and difficult journey, usually on foot.',
    img: '🥾',
    options: ['launch', 'circumnavigate', 'trek', 'map'],
    answer: 2,
    explain: 'trek = 长途跋涉'
  },
  {
    q: 'To travel all the way around something, especially the world.',
    img: '🌍',
    options: ['explore', 'circumnavigate', 'launch', 'settle'],
    answer: 1,
    explain: 'circumnavigate = 环航、环绕世界'
  },
  {
    q: 'To send a ship, rocket or spacecraft into the sky or sea.',
    img: '🛫',
    options: ['seek', 'endure', 'launch', 'motivate'],
    answer: 2,
    explain: 'launch = 发射'
  },
  {
    q: 'The line that marks the edge or limit of an area.',
    img: '🚧',
    options: ['network', 'boundary', 'mission', 'hypothesis'],
    answer: 1,
    explain: 'boundary = 边界'
  },
  {
    q: 'The ability to continue doing something difficult for a long time.',
    img: '🏃',
    options: ['motivation', 'thrill', 'endurance', 'civility'],
    answer: 2,
    explain: 'endurance = 耐力'
  },
  {
    q: 'An important job or task that someone is sent to do.',
    img: '🎯',
    options: ['boundary', 'trek', 'mission', 'seek'],
    answer: 2,
    explain: 'mission = 任务'
  },
  {
    q: 'An idea that is tested through experiments to see if it is true.',
    img: '🔬',
    options: ['mission', 'settlement', 'hypothesis', 'network'],
    answer: 2,
    explain: 'hypothesis = 假设'
  },
  {
    q: 'To discover or draw the features of an area or the world.',
    img: '🗺️',
    options: ['launch', 'map', 'endure', 'thrill'],
    answer: 1,
    explain: 'map (v.) = 绘制、勘测'
  },
  {
    q: 'To look for or try to find something.',
    img: '🔎',
    options: ['launch', 'motivate', 'seek', 'endure'],
    answer: 2,
    explain: 'seek = 寻找'
  },
  {
    q: 'A person who travels to new and unknown places to discover them.',
    img: '🧭',
    options: ['settler', 'explorer', 'captain', 'pilot'],
    answer: 1,
    explain: 'explorer = 探险家'
  }
];

module.exports = { QUESTIONS };

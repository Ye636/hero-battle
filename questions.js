// =====================================================
// 英雄知识大乱斗 —— 题库（英文释义选择题，每题配 emoji 图）
// 每题: { q(英文释义), img(emoji配图), options(英文单词), answer, explain }
// =====================================================
const QUESTIONS = [
  {
    q: 'A strong desire to learn or know something.',
    img: '🤔',
    options: ['curiosity', 'creativity', 'authenticity', 'clarity'],
    answer: 0,
    explain: 'curiosity = 好奇心（a desire to learn/know）'
  },
  {
    q: 'The ability to invent or make new and original things.',
    img: '💡',
    options: ['creativity', 'curiosity', 'mentality', 'humidity'],
    answer: 0,
    explain: 'creativity = 创造力'
  },
  {
    q: 'Being real or genuine, not copied or fake.',
    img: '🎭',
    options: ['authenticity', 'possibility', 'necessity', 'civility'],
    answer: 0,
    explain: 'authenticity = 真实性、真伪'
  },
  {
    q: 'The quality of being clear and easy to understand.',
    img: '🔍',
    options: ['clarity', 'intensity', 'humidity', 'mentality'],
    answer: 0,
    explain: 'clarity = 清晰（clear 的名词形式，不规则变化）'
  },
  {
    q: 'A chance that something may happen or be true.',
    img: '🌱',
    options: ['possibility', 'necessity', 'authenticity', 'curiosity'],
    answer: 0,
    explain: 'possibility = 可能性（possible 的名词）'
  },
  {
    q: 'Something that you must have or must do.',
    img: '⚙️',
    options: ['necessity', 'possibility', 'intensity', 'civility'],
    answer: 0,
    explain: 'necessity = 必需品、必要（necessary 的名词，不规则变化）'
  },
  {
    q: 'The amount of water vapor in the air.',
    img: '💧',
    options: ['humidity', 'clarity', 'mentality', 'curiosity'],
    answer: 0,
    explain: 'humidity = 湿度（humid 的名词）'
  },
  {
    q: "A person's way of thinking or their mental attitude.",
    img: '🧠',
    options: ['mentality', 'creativity', 'intensity', 'authenticity'],
    answer: 0,
    explain: 'mentality = 心态、思维方式'
  },
  {
    q: 'The strength or degree of something, often very strong.',
    img: '🔥',
    options: ['intensity', 'humidity', 'clarity', 'possibility'],
    answer: 0,
    explain: 'intensity = 强度（intense 的名词）'
  },
  {
    q: 'Polite, calm and respectful behaviour towards others.',
    img: '🤝',
    options: ['civility', 'necessity', 'mentality', 'curiosity'],
    answer: 0,
    explain: 'civility = 礼貌、文明（civil 的名词）'
  },
  {
    q: 'The reason or drive that makes you want to do something.',
    img: '🚀',
    options: ['motivation', 'mission', 'boundary', 'thrill'],
    answer: 0,
    explain: 'motivation = 动力、动机'
  },
  {
    q: 'A sudden feeling of excitement and pleasure.',
    img: '🎢',
    options: ['thrill', 'endurance', 'network', 'settlement'],
    answer: 0,
    explain: 'thrill = 刺激、兴奋'
  },
  {
    q: 'A place where people come to live and make their homes.',
    img: '🏠',
    options: ['settlement', 'mission', 'hypothesis', 'boundary'],
    answer: 0,
    explain: 'settlement = 定居点'
  },
  {
    q: 'A system of connected people, routes or things.',
    img: '🕸️',
    options: ['network', 'trek', 'launch', 'seek'],
    answer: 0,
    explain: 'network = 网络'
  },
  {
    q: 'A long and difficult journey, usually on foot.',
    img: '🥾',
    options: ['trek', 'launch', 'circumnavigate', 'map'],
    answer: 0,
    explain: 'trek = 长途跋涉'
  },
  {
    q: 'To travel all the way around something, especially the world.',
    img: '🌍',
    options: ['circumnavigate', 'explore', 'launch', 'settle'],
    answer: 0,
    explain: 'circumnavigate = 环航、环绕世界'
  },
  {
    q: 'To send a ship, rocket or spacecraft into the sky or sea.',
    img: '🛫',
    options: ['launch', 'seek', 'endure', 'motivate'],
    answer: 0,
    explain: 'launch = 发射'
  },
  {
    q: 'The line that marks the edge or limit of an area.',
    img: '🚧',
    options: ['boundary', 'network', 'mission', 'hypothesis'],
    answer: 0,
    explain: 'boundary = 边界'
  },
  {
    q: 'The ability to continue doing something difficult for a long time.',
    img: '🏃',
    options: ['endurance', 'motivation', 'thrill', 'civility'],
    answer: 0,
    explain: 'endurance = 耐力'
  },
  {
    q: 'An important job or task that someone is sent to do.',
    img: '🎯',
    options: ['mission', 'boundary', 'trek', 'seek'],
    answer: 0,
    explain: 'mission = 任务'
  },
  {
    q: 'An idea that is tested through experiments to see if it is true.',
    img: '🔬',
    options: ['hypothesis', 'mission', 'settlement', 'network'],
    answer: 0,
    explain: 'hypothesis = 假设'
  },
  {
    q: 'To discover or draw the features of an area or the world.',
    img: '🗺️',
    options: ['map', 'launch', 'endure', 'thrill'],
    answer: 0,
    explain: 'map (v.) = 绘制、勘测'
  },
  {
    q: 'To look for or try to find something.',
    img: '🔎',
    options: ['seek', 'launch', 'motivate', 'endure'],
    answer: 0,
    explain: 'seek = 寻找'
  },
  {
    q: 'A person who travels to new and unknown places to discover them.',
    img: '🧭',
    options: ['explorer', 'settler', 'captain', 'pilot'],
    answer: 0,
    explain: 'explorer = 探险家'
  }
];

module.exports = { QUESTIONS };

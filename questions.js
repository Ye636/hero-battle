// =====================================================
// 英雄知识大乱斗 —— 题库
// 来源：课本第四本 p372（-ity 词形变化 + exploration 选词填空）
// 每题为 {q, options, answer, explain}
// =====================================================
const QUESTIONS = [
  // ---- A. suffix -ity：名词对应的形容词 ----
  {
    q: '"curiosity"（好奇心）这个名词是由哪个形容词变来的？',
    options: ['curious', 'cure', 'currently', 'curtain'],
    answer: 0,
    explain: 'curious（好奇的）→ curiosity。属于规则变化（-ous → -osity）。'
  },
  {
    q: '"creativity"（创造力）是由哪个形容词变来的？',
    options: ['create', 'creative', 'creature', 'creator'],
    answer: 1,
    explain: 'creative（有创造力的）→ creativity。规则变化。'
  },
  {
    q: '"authenticity"（真实性）是由哪个形容词变来的？',
    options: ['author', 'authentic', 'autumn', 'authority'],
    answer: 1,
    explain: 'authentic（真迹的、真正的）→ authenticity。'
  },
  {
    q: '"clarity"（清晰）是由哪个形容词变来的？',
    options: ['clear', 'clerk', 'class', 'climb'],
    answer: 0,
    explain: 'clear（清楚的）→ clarity。注意：clear → clarity 是不规则变化（去 e + -ity）。'
  },
  {
    q: '"possibility"（可能性）是由哪个形容词变来的？',
    options: ['possible', 'posture', 'pocket', 'position'],
    answer: 0,
    explain: 'possible（可能的）→ possibility（le → bility）。'
  },
  {
    q: '"necessity"（必需品/必然）是由哪个形容词变来的？',
    options: ['necessary', 'nest', 'never', 'notice'],
    answer: 0,
    explain: 'necessary（必要的）→ necessity（去 y + -ity）。不规则变化之一。'
  },
  {
    q: '"humidity"（湿度）是由哪个形容词变来的？',
    options: ['human', 'humor', 'humid', 'hundred'],
    answer: 2,
    explain: 'humid（潮湿的）→ humidity。'
  },
  {
    q: '"mentality"（心态）是由哪个形容词变来的？',
    options: ['mental', 'mention', 'metal', 'menu'],
    answer: 0,
    explain: 'mental（精神的、心理的）→ mentality。'
  },
  {
    q: '"intensity"（强度）是由哪个形容词变来的？',
    options: ['intend', 'intense', 'intent', 'into'],
    answer: 1,
    explain: 'intense（强烈的）→ intensity。'
  },
  {
    q: '"civility"（礼貌、文明）是由哪个形容词变来的？',
    options: ['civil', 'citizen', 'city', 'circle'],
    answer: 0,
    explain: 'civil（公民的、文明的）→ civility。'
  },

  // ---- B. exploration & discovery 选词填空 ----
  {
    q: "Part of Sir Edmund Hillary's ___ to climb Mount Everest was for the thrill of being the first.",
    options: ['motivation', 'mission', 'network', 'boundary'],
    answer: 0,
    explain: 'motivation（动力）。希拉里攀登珠峰的部分动力在于成为第一人的那种刺激。'
  },
  {
    q: 'It was for the ___ of being the first to reach the top of Mount Everest.',
    options: ['hypothesis', 'thrill', 'endurance', 'settlement'],
    answer: 1,
    explain: 'thrill（刺激、兴奋）。'
  },
  {
    q: 'Polynesians explored the oceans by canoe and established ___ on islands around the Pacific.',
    options: ['networks', 'boundaries', 'settlements', 'missions'],
    answer: 2,
    explain: 'establish settlements（建立定居点）。'
  },
  {
    q: 'They set up extensive trading ___, exchanging many types of plants and animals.',
    options: ['networks', 'boundaries', 'thrills', 'hypotheses'],
    answer: 0,
    explain: 'trading networks（贸易网络）。'
  },
  {
    q: 'Isabella Bird ___ up an active volcano during her exploration of the United States.',
    options: ['trekked', 'mapped', 'launched', 'sought'],
    answer: 0,
    explain: 'trek up a volcano（长途跋涉登上火山）。'
  },
  {
    q: 'Annie Londonderry became the first woman to ___ the world on a bicycle.',
    options: ['circumnavigate', 'launch', 'motivate', 'settle'],
    answer: 0,
    explain: 'circumnavigate（环航、环球）。'
  },
  {
    q: 'The ___ of Apollo 8 in December 1968 marked a turning point in space exploration.',
    options: ['launch', 'mission', 'boundary', 'settlement'],
    answer: 0,
    explain: 'the launch of Apollo 8（阿波罗8号的发射）。'
  },
  {
    q: 'The human race was pushing the ___ of our knowledge about the universe.',
    options: ['networks', 'boundaries', 'thrills', 'missions'],
    answer: 1,
    explain: 'push the boundaries of knowledge（拓展知识的边界）。'
  },
  {
    q: "Shackleton tested the limits of his crew's ___ by sailing 720 miles across the South Atlantic.",
    options: ['motivation', 'mission', 'endurance', 'hypothesis'],
    answer: 2,
    explain: 'endurance（耐力、忍耐力）。'
  },
  {
    q: "NASA's Curiosity landed on Mars in 2012. Its ___ is to gather scientific data on climate and geology.",
    options: ['mission', 'boundary', 'network', 'thrill'],
    answer: 0,
    explain: 'mission（任务）。'
  },
  {
    q: 'Curiosity was sent to test the ___ about the existence of water on Mars.',
    options: ['hypothesis', 'mission', 'boundary', 'endurance'],
    answer: 0,
    explain: 'hypothesis（假设）。'
  },
  {
    q: 'Explorers like Zheng He, Vasco da Gama and James Cook ___ the world.',
    options: ['mapped', 'launched', 'trekked', 'sought'],
    answer: 0,
    explain: 'map the world（绘制世界地图）。'
  },
  {
    q: 'They wanted to better humanity, not just ___ fame and fortune.',
    options: ['seek', 'motivate', 'launch', 'endure'],
    answer: 0,
    explain: 'seek fame and fortune（追逐名利）。'
  },
  {
    q: '下面哪个形容词 → 名词是**不规则**变化？',
    options: ['clear → clarity', 'curious → curiosity', 'humid → humidity', 'civil → civility'],
    answer: 0,
    explain: 'clear → clarity 是不规则变化（去 e）；其余多为规则加 -ity。'
  }
];

module.exports = { QUESTIONS };

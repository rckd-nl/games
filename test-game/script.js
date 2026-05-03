const cardTitle = document.getElementById('card-title');
const cardText = document.getElementById('card-text');
const progress = document.getElementById('progress');
const result = document.getElementById('result');
const cardEl = document.getElementById('card');

const foodEl = document.getElementById('food');
const goldEl = document.getElementById('gold');
const moraleEl = document.getElementById('morale');

const leftBtn = document.getElementById('left-btn');
const rightBtn = document.getElementById('right-btn');
const restartBtn = document.getElementById('restart-btn');

const cards = [
  { title: 'Hungry Travelers', text: 'A caravan asks for food.', left: { food: -2, morale: -1, msg: 'You turned them away.' }, right: { food: -1, morale: 1, msg: 'You shared supplies.' } },
  { title: 'Broken Bridge', text: 'Repair now or wait?', left: { gold: -2, morale: 1, msg: 'You paid for repairs.' }, right: { food: -1, morale: -1, msg: 'Trade slowed down.' } },
  { title: 'Tax Proposal', text: 'Raise taxes for the treasury?', left: { gold: 2, morale: -2, msg: 'People are upset.' }, right: { gold: -1, morale: 1, msg: 'Citizens feel relieved.' } },
  { title: 'Festival Night', text: 'Fund a small festival?', left: { gold: -1, morale: 2, msg: 'The town celebrates.' }, right: { morale: -1, msg: 'The mood stays low.' } },
  { title: 'Wolf Problem', text: 'Hire hunters?', left: { gold: -1, food: 1, msg: 'Roads become safer.' }, right: { food: -1, morale: -1, msg: 'Wolves raid farms.' } },
  { title: 'Irrigation', text: 'Build new canals?', left: { gold: -2, food: 2, msg: 'Future harvests improve.' }, right: { food: -1, msg: 'Fields remain dry.' } },
  { title: 'Scholar Visit', text: 'Sponsor village school?', left: { gold: -1, morale: 1, msg: 'Knowledge spreads.' }, right: { morale: -1, msg: 'Children go without lessons.' } },
  { title: 'Mine Collapse', text: 'Shut mine for safety?', left: { gold: -2, morale: 1, msg: 'Workers trust you.' }, right: { gold: 1, morale: -2, msg: 'Accidents fuel anger.' } },
  { title: 'Merchant Deal', text: 'Buy grain at high price?', left: { gold: -2, food: 2, msg: 'Stores refill before winter.' }, right: { food: -2, morale: -1, msg: 'Food shortage worsens.' } },
  { title: 'Final Choice', text: 'Open the gates to newcomers?', left: { food: -1, morale: 2, msg: 'New families join happily.' }, right: { food: 1, morale: -2, msg: 'Village stays isolated.' } },
];

let state = { food: 5, gold: 5, morale: 5 };
let index = 0;
let gameOver = false;
let startX = 0;

function clamp(value) {
  return Math.max(0, Math.min(10, value));
}

function renderStats() {
  foodEl.textContent = state.food;
  goldEl.textContent = state.gold;
  moraleEl.textContent = state.morale;
}

function renderCard() {
  if (gameOver) return;
  const card = cards[index];
  progress.textContent = `Card ${index + 1} of ${cards.length}`;
  cardTitle.textContent = card.title;
  cardText.textContent = card.text;
}

function finishGame(message) {
  gameOver = true;
  result.textContent = message;
  cardTitle.textContent = 'Run Complete';
  cardText.textContent = 'Restart to try a different decision path.';
  progress.textContent = `Card ${Math.min(index + 1, cards.length)} of ${cards.length}`;
  leftBtn.disabled = true;
  rightBtn.disabled = true;
  restartBtn.hidden = false;
}

function applyChoice(side) {
  if (gameOver) return;

  const card = cards[index];
  const outcome = card[side];

  state.food = clamp(state.food + (outcome.food ?? 0));
  state.gold = clamp(state.gold + (outcome.gold ?? 0));
  state.morale = clamp(state.morale + (outcome.morale ?? 0));

  renderStats();
  result.textContent = outcome.msg;

  if (state.food === 0 || state.gold === 0 || state.morale === 0) {
    finishGame('One resource hit zero. Your village could not survive.');
    return;
  }

  index += 1;

  if (index >= cards.length) {
    finishGame('You completed all 10 cards and kept the village stable!');
    return;
  }

  renderCard();
}

function resetGame() {
  state = { food: 5, gold: 5, morale: 5 };
  index = 0;
  gameOver = false;
  result.textContent = '';
  leftBtn.disabled = false;
  rightBtn.disabled = false;
  restartBtn.hidden = true;
  renderStats();
  renderCard();
}

leftBtn.addEventListener('click', () => applyChoice('left'));
rightBtn.addEventListener('click', () => applyChoice('right'));
restartBtn.addEventListener('click', resetGame);

document.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowLeft') applyChoice('left');
  if (event.key === 'ArrowRight') applyChoice('right');
});

cardEl.addEventListener('touchstart', (event) => {
  startX = event.changedTouches[0].clientX;
});

cardEl.addEventListener('touchend', (event) => {
  const endX = event.changedTouches[0].clientX;
  const delta = endX - startX;
  if (delta > 35) applyChoice('right');
  if (delta < -35) applyChoice('left');
});

resetGame();

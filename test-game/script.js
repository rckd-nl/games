const scoreEl = document.getElementById('score');
const tapBtn = document.getElementById('tap-btn');
const resetBtn = document.getElementById('reset-btn');

let score = 0;

function render() {
  scoreEl.textContent = String(score);
}

tapBtn.addEventListener('click', () => {
  score += 1;
  render();
});

resetBtn.addEventListener('click', () => {
  score = 0;
  render();
});

render();

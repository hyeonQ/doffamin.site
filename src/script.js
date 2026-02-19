(() => {
  const revealItems = document.querySelectorAll('.reveal');
  const observer = new IntersectionObserver(
    entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.2 }
  );

  revealItems.forEach(item => observer.observe(item));

  const countElements = document.querySelectorAll('[data-count]');
  const animateCount = el => {
    const target = Number(el.dataset.count);
    let current = 0;
    const step = Math.max(1, Math.round(target / 35));
    const timer = setInterval(() => {
      current += step;
      if (current >= target) {
        el.textContent = `${target}${target === 100 ? '+' : ''}`;
        clearInterval(timer);
        return;
      }
      el.textContent = current;
    }, 24);
  };
  countElements.forEach(animateCount);

  const year = document.getElementById('year');
  if (year) year.textContent = String(new Date().getFullYear());

  const form = document.getElementById('gform');
  const thankYouMessage = document.getElementById('thankyou_message');

  if (!form) return;

  form.addEventListener('submit', event => {
    event.preventDefault();

    const data = new FormData(form);
    const action = form.action;
    const submitBtn = form.querySelector('.btn-submit');

    submitBtn.disabled = true;
    submitBtn.innerText = 'Sending...';

    fetch(action, {
      method: 'POST',
      body: data,
    })
      .then(() => {
        form.style.display = 'none';
        thankYouMessage.style.display = 'block';
      })
      .catch(error => {
        console.error('Error:', error);
        alert('An error occurred. Please try again later.');
        submitBtn.disabled = false;
        submitBtn.innerText = 'Send Message';
      });
  });
})();

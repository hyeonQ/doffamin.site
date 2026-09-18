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
  const formError = document.getElementById('form_error');

  if (!form) return;

  const submitBtn = form.querySelector('.btn-submit');
  const turnstileBox = form.querySelector('.cf-turnstile');

  const ERROR_MESSAGES = {
    turnstile_missing: '보안 확인이 끝날 때까지 잠시 기다린 뒤 다시 보내주세요.',
    turnstile_failed: '보안 확인이 만료되었거나 실패했습니다. 다시 시도해 주세요.',
    invalid_fields: '이름, 이메일, 메시지를 확인해 주세요.',
    not_configured: '문의 기능이 아직 설정되지 않았습니다. 잠시 후 다시 시도해 주세요.',
    forward_failed: '메시지를 전달하지 못했습니다. 잠시 후 다시 시도해 주세요.',
    network: '네트워크 오류가 발생했습니다. 연결을 확인한 뒤 다시 시도해 주세요.',
  };

  const showError = code => {
    if (!formError) return;
    formError.textContent = ERROR_MESSAGES[code] || ERROR_MESSAGES.forward_failed;
    formError.hidden = false;
  };

  const setBusy = busy => {
    submitBtn.disabled = busy;
    submitBtn.innerText = busy ? 'Sending...' : 'Send Message';
  };

  // Turnstile tokens are single-use: after a rejected submit the widget must issue a new one.
  const resetTurnstile = () => {
    if (window.turnstile && turnstileBox) window.turnstile.reset(turnstileBox);
  };

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (formError) formError.hidden = true;

    const data = new FormData(form);
    if (!data.get('cf-turnstile-response')) {
      showError('turnstile_missing');
      return;
    }

    setBusy(true);
    try {
      const response = await fetch(form.action, {
        method: 'POST',
        body: data,
        headers: { Accept: 'application/json' },
      });
      const result = await response.json().catch(() => ({}));
      if (response.ok && result.ok) {
        form.style.display = 'none';
        thankYouMessage.style.display = 'block';
        return;
      }
      showError(result.error);
      resetTurnstile();
    } catch (error) {
      console.error('Error:', error);
      showError('network');
      resetTurnstile();
    } finally {
      setBusy(false);
    }
  });
})();

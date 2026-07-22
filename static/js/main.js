/* Atlas Rising — interactions minimales (vanilla JS, pas de dépendance) */

document.addEventListener('DOMContentLoaded', function () {

  /* --- Menu mobile --- */
  var toggle = document.querySelector('.nav-toggle');
  var nav = document.getElementById('site-nav');

  if (toggle && nav) {
    toggle.addEventListener('click', function () {
      var open = nav.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });

    nav.addEventListener('click', function (e) {
      if (e.target.tagName === 'A') {
        nav.classList.remove('is-open');
        toggle.setAttribute('aria-expanded', 'false');
      }
    });
  }

  /* --- Formulaires newsletter (pas encore branchés à un service d'envoi) --- */
  var forms = document.querySelectorAll('[data-newsletter]');
  forms.forEach(function (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var button = form.querySelector('button');
      var original = button.textContent;
      button.textContent = 'Merci !';
      button.disabled = true;
      form.reset();
      setTimeout(function () {
        button.textContent = original;
        button.disabled = false;
      }, 3000);
    });
  });

});

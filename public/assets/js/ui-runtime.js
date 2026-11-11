/* Presentation adapters only. Native dialogs stay native when supported. */
(function () {
  'use strict';
  var stack = [];
  function prepare(dialog) {
    if (!('open' in dialog)) Object.defineProperty(dialog, 'open', {
      get: function () { return dialog.hasAttribute('open'); }
    });
  }
  function focusable(dialog) {
    var controls = [];
    function collect(root) {
      Array.prototype.forEach.call(root.querySelectorAll('*'), function (el) {
        if (el.matches('button,a[href],input,select,textarea,[tabindex]') && !el.disabled && el.tabIndex >= 0 && el.getClientRects().length) controls.push(el);
        if (el.shadowRoot) collect(el.shadowRoot);
      });
    }
    collect(dialog);return controls;
  }
  function activeControl() {
    var active = document.activeElement;
    while (active && active.shadowRoot && active.shadowRoot.activeElement) active = active.shadowRoot.activeElement;
    return active;
  }
  function closeDialog(dialog, value) {
    var index = stack.findIndex(function (entry) { return entry.dialog === dialog; });
    if (index < 0) {
      if (!dialog.open) return;
      try { if (typeof dialog.close === 'function') { dialog.close(value); return; } } catch (_) {}
      dialog.removeAttribute('open');
      setTimeout(function () { dialog.dispatchEvent(new Event('close')); }, 0);
      return;
    }
    var entry = stack.splice(index, 1)[0];
    dialog.removeAttribute('open');
    dialog.classList.remove('dialog-fallback');
    dialog.style.removeProperty('z-index');
    dialog.removeAttribute('aria-modal');
    entry.backdrop.remove();
    if (value !== undefined) dialog.returnValue = value;
    if (entry.focus && entry.focus.isConnected) entry.focus.focus();
    setTimeout(function () { dialog.dispatchEvent(new Event('close')); }, 0);
  }
  function openDialog(dialog) {
    prepare(dialog);
    if (dialog.open) return;
    try { if (typeof dialog.showModal === 'function') { dialog.showModal(); return; } } catch (_) {}
    var backdrop = document.createElement('div');
    backdrop.className = 'dialog-backdrop-fallback';
    backdrop.style.zIndex = String(3000 + stack.length * 2);
    backdrop.setAttribute('aria-hidden', 'true');
    var entry = {dialog: dialog, backdrop: backdrop, focus: document.activeElement};
    stack.push(entry);
    document.body.appendChild(backdrop);
    dialog.classList.add('dialog-fallback');
    dialog.style.zIndex = String(3001 + (stack.length - 1) * 2);
    dialog.setAttribute('open', '');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    if (!dialog.hasAttribute('tabindex')) dialog.tabIndex = -1;
    backdrop.addEventListener('click', function () { dialog.dispatchEvent(new MouseEvent('click', {bubbles: true})); });
    var controls = focusable(dialog);
    (controls[0] || dialog).focus();
  }
  // Replicate the modal boundary only for the fallback, without changing the
  // browser's prototypes or the game's event handlers and confirmation rules.
  ['pointerdown', 'click', 'touchstart', 'submit', 'focusin'].forEach(function (name) {
    document.addEventListener(name, function (event) {
      var entry = stack[stack.length - 1];
      if (!entry || entry.dialog.contains(event.target) || event.target === entry.backdrop) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (name === 'focusin') entry.dialog.focus();
    }, true);
  });
  document.addEventListener('keydown', function (event) {
    var entry = stack[stack.length - 1];
    if (!entry) return;
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopImmediatePropagation();
      var cancel = new Event('cancel', {cancelable: true});
      if (entry.dialog.dispatchEvent(cancel)) closeDialog(entry.dialog);
    } else if (event.key === 'Tab') {
      var controls = focusable(entry.dialog), first = controls[0], last = controls[controls.length - 1], active = activeControl();
      if (!first) { event.preventDefault(); entry.dialog.focus(); }
      else if (event.shiftKey && (active === first || active === entry.dialog || !entry.dialog.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (active === last || active === entry.dialog || !entry.dialog.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    }
  }, true);
  document.addEventListener('submit', function (event) {
    var form = event.target, entry = stack[stack.length - 1];
    if (!entry || !entry.dialog.contains(form) || form.getAttribute('method') !== 'dialog') return;
    event.preventDefault(); closeDialog(entry.dialog, event.submitter ? event.submitter.value : '');
  });
  function submitForm(form) {
    if (typeof form.requestSubmit === 'function') { form.requestSubmit(); return; }
    if (form.checkValidity && !form.checkValidity()) { if (form.reportValidity) form.reportValidity(); return; }
    form.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}));
  }
  function supports(property, value) { return !!(window.CSS && CSS.supports && CSS.supports(property, value)); }
  document.documentElement.classList.toggle('no-aspect-ratio', !supports('aspect-ratio', '3 / 2'));
  document.documentElement.classList.toggle('no-container-units', !supports('font-size', '1cqw'));
  document.documentElement.classList.toggle('no-dynamic-viewport', !supports('height', '100dvh'));
  Array.prototype.forEach.call(document.querySelectorAll('dialog'), prepare);
  window.TrainUI = {openDialog: openDialog, closeDialog: closeDialog, submitForm: submitForm};
})();

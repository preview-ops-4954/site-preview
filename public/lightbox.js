// Shared photo lightbox for JWRE property websites and the agent portal.
// Any <a data-lightbox="group" data-caption="..." href="/full/image.jpg"> wrapping
// a thumbnail becomes clickable; the overlay only ever loads URLs already on the
// page, so it cannot expose files the page itself does not show.
(function () {
  'use strict';
  var triggers = Array.prototype.slice.call(document.querySelectorAll('a[data-lightbox]'));
  if (!triggers.length) return;

  var groups = {};
  triggers.forEach(function (t) {
    var g = t.getAttribute('data-lightbox') || 'default';
    (groups[g] = groups[g] || []).push(t);
    t.addEventListener('click', function (e) {
      e.preventDefault();
      open(g, groups[g].indexOf(t));
    });
  });

  var overlay = document.createElement('div');
  overlay.className = 'lb';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Photo viewer');
  overlay.hidden = true;
  overlay.innerHTML =
    '<div class="lb-backdrop"></div>' +
    '<p class="lb-count" aria-live="polite"></p>' +
    '<a class="lb-download" href="#" download>Download original</a>' +
    '<button type="button" class="lb-btn lb-close" aria-label="Close photo viewer">&times;</button>' +
    '<button type="button" class="lb-btn lb-prev" aria-label="Previous photo">&#8249;</button>' +
    '<button type="button" class="lb-btn lb-next" aria-label="Next photo">&#8250;</button>' +
    '<figure class="lb-stage">' +
      '<img class="lb-img" alt="">' +
      '<figcaption class="lb-caption"></figcaption>' +
    '</figure>';
  document.body.appendChild(overlay);

  var img = overlay.querySelector('.lb-img');
  var caption = overlay.querySelector('.lb-caption');
  var count = overlay.querySelector('.lb-count');
  var download = overlay.querySelector('.lb-download');
  var btnClose = overlay.querySelector('.lb-close');
  var btnPrev = overlay.querySelector('.lb-prev');
  var btnNext = overlay.querySelector('.lb-next');
  var backdrop = overlay.querySelector('.lb-backdrop');

  var items = [];
  var idx = 0;
  var isOpen = false;
  var lastFocus = null;

  function preload(i) {
    if (i < 0 || i >= items.length) return;
    var pre = new Image();
    pre.src = items[i].href;
  }

  function show(i) {
    idx = (i + items.length) % items.length;
    var t = items[idx];
    var cap = t.getAttribute('data-caption') || '';
    img.src = t.href;
    img.alt = cap || 'Photo ' + (idx + 1) + ' of ' + items.length;
    caption.textContent = cap;
    caption.style.display = cap ? '' : 'none';
    count.textContent = (idx + 1) + ' of ' + items.length;
    // Downloads are opt-in per trigger (data-download): the agent portal offers
    // originals after payment; public property websites are view-only.
    download.hidden = !t.hasAttribute('data-download');
    download.href = t.href;
    var single = items.length < 2;
    btnPrev.hidden = single;
    btnNext.hidden = single;
    preload(idx - 1);
    preload(idx + 1);
  }

  function open(group, i) {
    items = groups[group] || [];
    if (!items.length) return;
    lastFocus = document.activeElement;
    overlay.hidden = false;
    document.body.classList.add('lb-open');
    isOpen = true;
    show(i);
    btnClose.focus();
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    overlay.hidden = true;
    document.body.classList.remove('lb-open');
    img.removeAttribute('src');
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  btnClose.addEventListener('click', close);
  backdrop.addEventListener('click', close);
  btnPrev.addEventListener('click', function () { show(idx - 1); });
  btnNext.addEventListener('click', function () { show(idx + 1); });

  document.addEventListener('keydown', function (e) {
    if (!isOpen) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); show(idx - 1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); show(idx + 1); }
    else if (e.key === 'Tab') {
      var focusables = [btnClose, download, btnPrev, btnNext].filter(function (el) { return !el.hidden; });
      var pos = focusables.indexOf(document.activeElement);
      e.preventDefault();
      var next = e.shiftKey ? (pos <= 0 ? focusables.length - 1 : pos - 1) : (pos >= focusables.length - 1 ? 0 : pos + 1);
      focusables[next].focus();
    }
  });

  // Swipe left/right to move between photos on touch screens.
  var touchX = null;
  var touchY = null;
  overlay.addEventListener('touchstart', function (e) {
    if (e.touches.length === 1) {
      touchX = e.touches[0].clientX;
      touchY = e.touches[0].clientY;
    }
  }, { passive: true });
  overlay.addEventListener('touchend', function (e) {
    if (touchX === null) return;
    var dx = e.changedTouches[0].clientX - touchX;
    var dy = e.changedTouches[0].clientY - touchY;
    touchX = null;
    touchY = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      show(idx + (dx < 0 ? 1 : -1));
    }
  }, { passive: true });
})();

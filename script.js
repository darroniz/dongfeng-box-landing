/* ============================================================
   Dongfeng BOX landing — interactions
   - Modal open/close (click, backdrop, Escape, focus trap)
   - Form submit: POST a Zapier + Apps Script (Sheet backup) + dataLayer
   - Success view tras enviar el formulario
   - Sticky CTA mobile (visible after hero, hidden near final CTA)
   - Top bar dismiss
   - Reveal on scroll (respects prefers-reduced-motion)
   ============================================================ */

(() => {
  'use strict';

  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

  /* ----------  MODAL  ---------- */
  const modal = $('#modal');
  const modalContent = $('.modal__content', modal);
  let lastFocused = null;

  function openModal() {
    lastFocused = document.activeElement;
    modal.hidden = false;
    document.documentElement.style.overflow = 'hidden';
    // focus first interactive inside modal after paint
    requestAnimationFrame(() => {
      const firstInput = $('input, button', modal);
      if (firstInput) firstInput.focus();
    });
  }

  function closeModal() {
    modal.hidden = true;
    document.documentElement.style.overflow = '';
    // reset views
    $$('.modal__body', modal).forEach(v => v.hidden = v.dataset.view !== 'form');
    $('#leadForm')?.reset();
    if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
  }

  $$('[data-open-modal]').forEach(btn => btn.addEventListener('click', (e) => {
    e.preventDefault();
    openModal();
  }));

  $$('[data-close-modal]').forEach(el => el.addEventListener('click', closeModal));

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.hidden) closeModal();
    // simple focus trap
    if (e.key === 'Tab' && !modal.hidden) {
      const focusables = $$('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])', modalContent)
        .filter(el => !el.hasAttribute('disabled') && el.offsetParent !== null);
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });

  /* ----------  FORM SUBMIT  ---------- */
  const ZAPIER_WEBHOOK = 'https://hooks.zapier.com/hooks/catch/3397010/2nzkijc/';
  const SHEET_WEBHOOK = 'https://script.google.com/macros/s/AKfycbyRGau3SQYnc4YEHuBRIOGoFpoH4WhT_VBUGOAO9Qj70HVX966LemFoh_ER-mfS9B6w/exec';

  function splitName(fullName) {
    const parts = (fullName || '').trim().split(/\s+/);
    return { first: parts.shift() || '', last: parts.join(' ') };
  }

  // E.164 español. Enhanced Conversions exige prefijo internacional para hacer match.
  function normalizePhoneES(raw) {
    let p = (raw || '').replace(/[\s\-().]/g, '');
    if (!p) return '';
    if (p.startsWith('00')) p = '+' + p.slice(2);
    if (p.startsWith('+')) return p;
    if (/^[6789]\d{8}$/.test(p)) return '+34' + p;
    return p;
  }

  // CP español → código de concesionario Salvador Caetano.
  // Rangos específicos sobrescriben el default provincial (Sabadell dentro de 08, Majadahonda dentro de 28, Gandía dentro de 46).
  function dealerCodeFromCP(cp) {
    const digits = (cp || '').replace(/\D/g, '');
    if (digits.length < 2) return '';
    const n = parseInt(digits, 10);
    if (n >= 8200 && n <= 8208) return 'DE00060002';   // Sabadell
    if (n >= 28220 && n <= 28229) return 'DE05710004'; // Majadahonda
    if (n >= 46700 && n <= 46729) return 'DE06350009'; // Gandía
    const province = digits.slice(0, 2);
    const provinceToDealer = {
      '03': 'DE00110011', // Alicante
      '07': 'DE00080001', // Palma de Mallorca
      '08': 'DE05840006', // Barcelona
      '15': 'DE00110012', // A Coruña
      '17': 'DE00180001', // Girona
      '19': 'DE00160001', // Guadalajara
      '28': 'DE00050002', // Madrid
      '29': 'DE01050013', // Málaga
      '30': 'DE00070002', // Murcia
      '31': 'DE00150001', // Navarra
      '33': 'DE00110005', // Oviedo (Asturias)
      '39': 'DE00070001', // Santander
      '41': 'DE00110001', // Sevilla
      '43': 'DE00140001', // Tarragona
      '47': 'DE00090001', // Valladolid
      '48': 'DE01100014', // Bilbao
      '50': 'DE00100004'  // Zaragoza
    };
    return provinceToDealer[province] || '';
  }

  function buildPayload({ name, last_name, phone, cp, email, dealer }) {
    return {
      Name: name,
      Last_Name: last_name,
      Email: email || '',
      Phone: phone,
      Model_Code: '819',
      Dealership_Code: dealer || '',
      Postal_Code: cp || '',
      Privacy_Policy: 'Y',
      Consent: true,
      Lead_Type: 'TP10',
      Request_Type: 'TPD10',
      Lead_Source: 'OL24',
      Form_Type: 'F12',
      Campaign_Code: 'CPH020',
      Brand_Code: 'DON',
      Country_Code: 'ES'
    };
  }

  // text/plain (CORS-safe) evita el preflight que Zapier rechaza con application/json.
  // Zapier interpreta el body como JSON igualmente.
  function sendToZapier(payload) {
    return fetch(ZAPIER_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    })
      .then(r => r.json().catch(() => ({ status: r.ok ? 'success' : 'error' })))
      .then(res => { console.info('[Dongfeng] zapier ok:', res); return res; })
      .catch(err => { console.error('[Dongfeng] zapier error:', err); });
  }

  // Apps Script web app: usa text/plain para evitar el preflight CORS, el body sigue siendo JSON.
  function sendToSheet(payload) {
    if (!SHEET_WEBHOOK) return Promise.resolve(null);
    return fetch(SHEET_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      redirect: 'follow'
    })
      .then(r => r.text().then(t => { try { return JSON.parse(t); } catch { return { status: r.ok ? 'success' : 'error', raw: t }; } }))
      .then(res => { console.info('[Dongfeng] sheet ok:', res); return res; })
      .catch(err => { console.error('[Dongfeng] sheet error:', err); });
  }

  const leadForm = $('#leadForm');
  if (leadForm) {
    leadForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(leadForm).entries());
      const { first, last } = splitName(data.name);
      const dealer = dealerCodeFromCP(data.cp);

      const payload = buildPayload({
        name: first,
        last_name: last,
        phone: data.phone || '',
        cp: data.cp || '',
        email: data.email || '',
        dealer
      });

      sendToZapier(payload);
      sendToSheet(payload);

      // Enhanced Conversions: GTM hashea (SHA-256) los campos de enhanced_conversion_data
      // antes de mandarlos a Google Ads. No hashear aquí.
      window.dataLayer = window.dataLayer || [];
      window.dataLayer.push({
        event: 'generate_lead',
        form_name: 'test_drive',
        dealer,
        enhanced_conversion_data: {
          email: data.email || '',
          phone_number: normalizePhoneES(data.phone),
          address: {
            first_name: first,
            last_name: last,
            postal_code: data.cp || '',
            country: 'ES'
          }
        }
      });

      $$('.modal__body', modal).forEach(v => v.hidden = v.dataset.view !== 'success');
    });
  }

  /* ----------  TOP BAR  ---------- */
  const topbar = $('#topbar');
  $('[data-close-topbar]')?.addEventListener('click', () => {
    topbar.hidden = true;
  });

  /* ----------  STICKY CTA MOBILE  ---------- */
  const stickyCta = $('#stickyCta');
  const heroEl = $('.hero');
  const ctaFinalEl = $('.cta-final');

  if (stickyCta && heroEl && ctaFinalEl && 'IntersectionObserver' in window) {
    let heroVisible = true;
    let ctaFinalVisible = false;

    const heroObs = new IntersectionObserver(([entry]) => {
      heroVisible = entry.isIntersecting;
      updateStickyCta();
    }, { threshold: 0.25 });

    const finalObs = new IntersectionObserver(([entry]) => {
      ctaFinalVisible = entry.isIntersecting;
      updateStickyCta();
    }, { threshold: 0.1 });

    heroObs.observe(heroEl);
    finalObs.observe(ctaFinalEl);

    function updateStickyCta() {
      const show = !heroVisible && !ctaFinalVisible;
      stickyCta.classList.toggle('is-visible', show);
    }
  }

  /* ----------  REVEAL ON SCROLL  ---------- */
  const prefersReducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!prefersReducedMotion && 'IntersectionObserver' in window) {
    const revealTargets = $$('.section-head, .step, .press-card, .testimonial, .benefit, .compare-table-wrap');
    revealTargets.forEach(el => el.classList.add('reveal'));
    const revealObs = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-in');
          revealObs.unobserve(entry.target);
        }
      });
    }, { rootMargin: '0px 0px -10% 0px', threshold: 0.1 });
    revealTargets.forEach(el => revealObs.observe(el));
  }

})();

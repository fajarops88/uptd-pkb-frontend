/* ==========================================================================
   APP.JS - Website UPTD PKB Balikpapan (SPA, frontend statis GitHub Pages)
   Bagian 1: Inti (state, utilitas, API, toast, modal, tema, navigasi, router)
   Aturan SPA: tidak memakai window.location / window.open / ?page=.
   Semua navigasi lewat navigateTo(); token sesi hanya di memori (AppState).
   Backend: Google Apps Script sebagai REST API murni (lihat GAS_URL di bawah).
   ========================================================================== */

// ---------- Alamat Web App GAS (akhiran /exec) ----------
var GAS_URL = 'https://script.google.com/macros/s/AKfycbwbbOTvmeDysm7SjyeZTf1U2u3chJu5fDznztFa9QbkzWeF97WgLnwNsbrTBcl4C-Dw/exec';

// ---------- State aplikasi (memori, bukan URL) ----------
var AppState = {
  page: null, params: {}, data: null, dataAt: 0, dirty: false,
  token: null, user: null, history: [], charts: [],
  tahunStat: null, cariIds: {}, adm: { page: 'dashboard', rows: [], modul: null }
};
var TEMA_KEY = 'uptd_tema';
var BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
var BULAN_PENDEK = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

// ---------- Utilitas ----------
function $(s, r) { return (r || document).querySelector(s); }
function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }

/** Escape HTML (anti-XSS). Wajib untuk SEMUA data dinamis yang masuk ke innerHTML. */
function esc(s) {
  return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function simpanLokal(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* diblokir: abaikan */ } }
function bacaLokal(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }

function fmtTanggal(s) {
  var m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return esc(s || '');
  return parseInt(m[3], 10) + ' ' + BULAN[parseInt(m[2], 10) - 1] + ' ' + m[1];
}
function fmtWaktu(s) {
  var m = String(s || '').match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})/);
  return m ? fmtTanggal(m[1]) + ', ' + m[2] : fmtTanggal(s);
}
function fmtAngka(n) { return Number(n || 0).toLocaleString('id-ID'); }
function debounce(fn, ms) { var t; return function () { var a = arguments, c = this; clearTimeout(t); t = setTimeout(function () { fn.apply(c, a); }, ms); }; }
function potongTeks(s, n) { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.substring(0, n - 1) + '…' : s; }

/** Tautan gambar Drive publik dan cadangannya. */
function urlGambar(id, w) { return 'https://lh3.googleusercontent.com/d/' + encodeURIComponent(id) + '=w' + (w || 800); }
function gambarFallback(el) {
  if (!el.dataset.fb) {
    el.dataset.fb = '1';
    el.src = 'https://drive.google.com/thumbnail?id=' + encodeURIComponent(el.dataset.id) + '&sz=w' + (el.dataset.w || 800);
  } else { el.onerror = null; el.style.visibility = 'hidden'; }
}
function imgTag(id, w, alt) {
  return '<img loading="lazy" decoding="async" src="' + urlGambar(id, w) + '" data-id="' + esc(id) + '" data-w="' + w +
    '" alt="' + esc(alt || '') + '" onerror="gambarFallback(this)">';
}
function urlPratinjauPdf(id) { return 'https://drive.google.com/file/d/' + encodeURIComponent(id) + '/preview'; }
function urlUnduh(id) { return 'https://drive.google.com/uc?export=download&id=' + encodeURIComponent(id); }

/** Mengubah teks polos petugas menjadi HTML aman: paragraf, "## judul", daftar "- " / "1. ", **tebal**, [teks](https://...). */
function renderTeks(teks) {
  var t = String(teks || '').replace(/\r\n?/g, '\n').trim();
  if (!t) return '';
  function inline(s) {
    s = esc(s);
    s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    return s;
  }
  return t.split(/\n{2,}/).map(function (blok) {
    var b = blok.trim(), baris = b.split('\n');
    if (/^##\s+/.test(b)) return '<h3>' + inline(b.replace(/^##\s+/, '')) + '</h3>';
    if (baris.every(function (l) { return /^\s*[-*]\s+/.test(l); })) {
      return '<ul>' + baris.map(function (l) { return '<li>' + inline(l.replace(/^\s*[-*]\s+/, '')) + '</li>'; }).join('') + '</ul>';
    }
    if (baris.every(function (l) { return /^\s*\d+[.)]\s+/.test(l); })) {
      return '<ol>' + baris.map(function (l) { return '<li>' + inline(l.replace(/^\s*\d+[.)]\s+/, '')) + '</li>'; }).join('') + '</ol>';
    }
    return '<p>' + baris.map(inline).join('<br>') + '</p>';
  }).join('');
}

// ---------- Pemanggilan server (fetch ke GAS REST API, dibungkus Promise) ----------
// Body dikirim sebagai text/plain (bukan application/json) khusus agar browser TIDAK
// mengirim preflight OPTIONS - Apps Script Web App tidak bisa membalas preflight itu.
function api(nama) {
  var args = Array.prototype.slice.call(arguments, 1);
  return fetch(GAS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ aksi: nama, args: args })
  }).then(function (res) {
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }).then(function (r) {
    r = r || { success: false, message: 'Respons server kosong.' };
    if (r.code === 'SESI') { sesiBerakhir(); }
    else if (r.code === 'GANTI') { tampilGantiWajib(); }
    return r;
  }).catch(function (e) {
    return { success: false, message: 'Koneksi ke server bermasalah: ' + e.message };
  });
}
/** Pemanggilan fungsi admin: token otomatis disisipkan sebagai argumen pertama. */
function apiA(nama) {
  var args = Array.prototype.slice.call(arguments, 1);
  return api.apply(null, [nama, AppState.token].concat(args));
}

function sibuk(btn, on, teks) {
  if (!btn) return;
  if (on) {
    btn.dataset.html = btn.innerHTML; btn.disabled = true;
    btn.innerHTML = '<span class="spinner" aria-hidden="true"></span> ' + esc(teks || 'Memproses...');
  } else {
    btn.disabled = false;
    if (btn.dataset.html !== undefined) { btn.innerHTML = btn.dataset.html; delete btn.dataset.html; }
  }
}

// ---------- Toast ----------
function toast(pesan, tipe, ms) {
  tipe = tipe || 'info';
  var ikon = { success: 'bi-check-circle-fill', error: 'bi-x-circle-fill', warning: 'bi-exclamation-triangle-fill', info: 'bi-info-circle-fill' }[tipe] || 'bi-info-circle-fill';
  var el = document.createElement('div');
  el.className = 'toast ' + tipe;
  el.setAttribute('role', tipe === 'error' ? 'alert' : 'status');
  el.innerHTML = '<i class="bi ' + ikon + '" aria-hidden="true"></i><div></div>';
  el.lastChild.textContent = pesan;
  $('#toast-root').appendChild(el);
  setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, ms || (tipe === 'error' ? 6500 : 3800));
}

// ---------- Modal ----------
var _modals = [];
/** opsi: {judul, isi(html aman), footer(html), lebar:'sm|lg|xl', statis, onBuka(m), onTutup()} */
function bukaModal(o) {
  var back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = '<div class="modal ' + (o.lebar || '') + '" role="dialog" aria-modal="true">' +
    '<div class="modal-head"><h2></h2>' + (o.statis ? '' : '<button type="button" class="icon-btn" data-tutup aria-label="Tutup"><i class="bi bi-x-lg" aria-hidden="true"></i></button>') + '</div>' +
    '<div class="modal-body"></div>' + (o.footer ? '<div class="modal-foot"></div>' : '') + '</div>';
  var dlg = $('.modal', back);
  $('h2', back).textContent = o.judul || '';
  $('.modal-body', back).innerHTML = o.isi || '';
  if (o.footer) $('.modal-foot', back).innerHTML = o.footer;
  var terfokus = document.activeElement;
  var m = {
    el: back, dialog: dlg, body: $('.modal-body', back), foot: $('.modal-foot', back), statis: !!o.statis,
    tutup: function () {
      var i = _modals.indexOf(m); if (i < 0) return;
      _modals.splice(i, 1);
      if (back.parentNode) back.parentNode.removeChild(back);
      if (!_modals.length) document.body.classList.remove('no-scroll');
      if (o.onTutup) o.onTutup();
      if (terfokus && terfokus.focus) { try { terfokus.focus(); } catch (e) { /* abaikan */ } }
    }
  };
  var tb = $('[data-tutup]', back);
  if (tb) tb.addEventListener('click', m.tutup);
  if (!o.statis) back.addEventListener('mousedown', function (e) { if (e.target === back) m.tutup(); });
  $('#modal-root').appendChild(back);
  _modals.push(m);
  document.body.classList.add('no-scroll');
  var fokus = $('input:not([type=hidden]):not([type=file]), select, textarea, .btn-navy, .btn-gold', dlg);
  if (fokus) { try { fokus.focus(); } catch (e) { /* abaikan */ } }
  if (o.onBuka) o.onBuka(m);
  return m;
}
function tutupModalTeratas() { if (_modals.length) _modals[_modals.length - 1].tutup(); }

/** Dialog konfirmasi. Mengembalikan Promise<boolean>. */
function konfirmasi(o) {
  return new Promise(function (resolve) {
    var selesai = false;
    var m = bukaModal({
      judul: o.judul || 'Konfirmasi', lebar: 'sm', isi: '<p class="mb-0">' + esc(o.pesan) + '</p>',
      footer: '<button type="button" class="btn btn-outline" data-x="0">Batal</button>' +
        '<button type="button" class="btn ' + (o.bahaya ? 'btn-danger' : 'btn-navy') + '" data-x="1">' + esc(o.tombol || 'Ya, lanjutkan') + '</button>',
      onTutup: function () { if (!selesai) { selesai = true; resolve(false); } }
    });
    $$('[data-x]', m.foot).forEach(function (b) {
      b.addEventListener('click', function () { selesai = true; m.tutup(); resolve(b.dataset.x === '1'); });
    });
  });
}

document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') {
    if ($('#lightbox')) { tutupLightbox(); return; }
    if (_modals.length) { var t = _modals[_modals.length - 1]; if (!t.statis) t.tutup(); return; }
    tutupDrawer();
  }
  if ($('#lightbox')) {
    if (e.key === 'ArrowLeft') geserLightbox(-1);
    if (e.key === 'ArrowRight') geserLightbox(1);
  }
});

// ---------- Tema ----------
function terapkanTema(t) {
  document.documentElement.setAttribute('data-theme', t);
  $$('.theme-toggle i').forEach(function (i) { i.className = 'bi ' + (t === 'dark' ? 'bi-sun' : 'bi-moon-stars'); });
}
function toggleTheme() {
  var t = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  simpanLokal(TEMA_KEY, t);
  terapkanTema(t);
  if (AppState.charts.length && typeof gambarChart === 'function') gambarChart();
}
function initTema() {
  var t = bacaLokal(TEMA_KEY);
  if (!t) { try { t = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; } catch (e) { t = 'light'; } }
  terapkanTema(t);
}

// ---------- Drawer seluler ----------
function bukaDrawer() {
  var d = $('#mobile-drawer'); d.classList.add('open'); d.setAttribute('aria-hidden', 'false');
  document.body.classList.add('no-scroll');
}
function tutupDrawer() {
  var d = $('#mobile-drawer'); if (!d || !d.classList.contains('open')) return;
  d.classList.remove('open'); d.setAttribute('aria-hidden', 'true');
  if (!_modals.length) document.body.classList.remove('no-scroll');
}

// ---------- Navigasi publik ----------
var NAV = [
  { id: 'beranda', label: 'Beranda', ikon: 'bi-house-door' },
  { label: 'Profil', ikon: 'bi-building', anak: [{ id: 'sejarah', label: 'Sejarah' }, { id: 'profil', label: 'Profil UPTD' }, { id: 'visi_misi', label: 'Visi dan Misi' }, { id: 'tugas_fungsi', label: 'Tugas dan Fungsi' }, { id: 'sambutan', label: 'Sambutan Kepala UPTD' }] },
  { label: 'Organisasi', ikon: 'bi-diagram-3', anak: [{ id: 'pejabat', label: 'Pejabat & Pegawai' }, { id: 'bagan', label: 'Bagan Organisasi' }] },
  { label: 'Layanan & Tarif', ikon: 'bi-cash-coin', anak: [{ id: 'tarif', label: 'Layanan & Tarif Uji' }, { id: 'syarat', label: 'Syarat & Alur Pengujian' }] },
  { id: 'dokumen', label: 'Regulasi & Dokumen', pendek: 'Dokumen', ikon: 'bi-file-earmark-text' },
  { id: 'galeri', label: 'Galeri', ikon: 'bi-images' },
  { id: 'berita', label: 'Berita', ikon: 'bi-newspaper' },
  { id: 'kontak', label: 'Kontak & Pengaduan', pendek: 'Kontak', ikon: 'bi-chat-dots' }
];
function navA(id, label, extra) {
  return '<a href="javascript:void(0)" data-page="' + id + '" onclick="' + (extra || '') + 'navigateTo(\'' + id + '\')">' + label + '</a>';
}
function renderNav() {
  $('#main-nav').innerHTML = NAV.map(function (n) {
    if (!n.anak) return '<div class="nav-item"><a class="nav-link" href="javascript:void(0)" data-page="' + n.id + '" onclick="navigateTo(\'' + n.id + '\')">' + esc(n.pendek || n.label) + '</a></div>';
    return '<div class="nav-item"><button type="button" class="nav-link" aria-haspopup="true">' + esc(n.label) + ' <i class="bi bi-chevron-down" style="font-size:11px" aria-hidden="true"></i></button>' +
      '<div class="nav-sub">' + n.anak.map(function (a) { return navA(a.id, esc(a.label)); }).join('') + '</div></div>';
  }).join('');
  $('#drawer-nav').innerHTML = NAV.map(function (n) {
    if (!n.anak) return navA(n.id, '<i class="bi ' + n.ikon + '" aria-hidden="true"></i> ' + esc(n.label), 'tutupDrawer();');
    return '<details><summary><i class="bi ' + n.ikon + '" aria-hidden="true"></i> ' + esc(n.label) + '</summary><div class="sub">' +
      n.anak.map(function (a) { return navA(a.id, esc(a.label), 'tutupDrawer();'); }).join('') + '</div></details>';
  }).join('');
  var flat = [];
  NAV.forEach(function (n) { if (n.anak) n.anak.forEach(function (a) { flat.push(a); }); else flat.push(n); });
  $('#footer-links').innerHTML = flat.map(function (a) { return '<li>' + navA(a.id, esc(a.label)) + '</li>'; }).join('');
}
function aktifkanNav(page) {
  var grup = {
    'berita-detail': 'berita', 'konfirmasi': 'kontak', 'berhenti': 'beranda'
  };
  var p = grup[page] || page;
  $$('#main-nav [data-page], #drawer-nav [data-page]').forEach(function (a) { a.classList.toggle('active', a.dataset.page === p); });
  $$('#main-nav .nav-item').forEach(function (it) {
    var b = $('button.nav-link', it);
    if (b) b.classList.toggle('active', !!$('.nav-sub a.active', it));
  });
  var bn = { beranda: 'beranda', tarif: 'tarif', syarat: 'tarif', berita: 'berita', kontak: 'kontak' }[p];
  $$('.bn-item').forEach(function (a) { a.classList.toggle('active', a.dataset.bn === bn); });
}

// ---------- Branding dari Config ----------
var LOGO_BAWAAN = '<svg viewBox="0 0 64 64" role="img" aria-label="Lambang UPTD PKB"><path d="M32 4 56 12v18c0 15-10 26-24 30C18 56 8 45 8 30V12z" fill="#0d2240" stroke="#fdbf4a" stroke-width="3"/>' +
  '<text x="32" y="38" text-anchor="middle" font-family="Public Sans,Arial" font-weight="700" font-size="17" fill="#fdbf4a">PKB</text></svg>';

function setCta(el, link) {
  if (!el) return;
  if (link && /^https?:\/\//i.test(link)) {
    el.setAttribute('href', link); el.setAttribute('target', '_blank'); el.setAttribute('rel', 'noopener noreferrer'); el.onclick = null;
  } else {
    el.setAttribute('href', 'javascript:void(0)'); el.removeAttribute('target');
    el.onclick = function () { toast('Tautan pendaftaran online belum diatur oleh petugas.', 'warning'); };
  }
}
function pasangCta() {
  var link = AppState.data ? AppState.data.config.link_pendaftaran : '';
  $$('#cta-daftar, #cta-daftar-m, [data-cta]').forEach(function (el) { setCta(el, link); });
}
function logoHtml(c) { return c && c.logo_file_id ? imgTag(c.logo_file_id, 200, 'Logo ' + (c.nama_uptd || '')) : LOGO_BAWAAN; }

function terapkanBrand() {
  var c = (AppState.data && AppState.data.config) || {};
  var logo = logoHtml(c);
  $('#brand-logo').innerHTML = logo; $('#footer-logo').innerHTML = logo;
  var inst = c.nama_instansi || 'Dinas Perhubungan Kota Balikpapan', uptd = c.nama_uptd || 'UPTD Pengujian Kendaraan Bermotor';
  $('#brand-instansi').textContent = inst; $('#brand-uptd').textContent = uptd;
  $('#footer-instansi').textContent = inst; $('#footer-uptd').textContent = uptd;
  $('#tb-jam').textContent = c.jam_layanan ? String(c.jam_layanan).split('\n')[0] : 'Jam layanan belum diisi';
  var kontak = [];
  if (c.alamat) kontak.push(esc(c.alamat));
  if (c.telepon) kontak.push('Telp: ' + esc(c.telepon));
  if (c.email_kontak) kontak.push('Email: ' + esc(c.email_kontak));
  $('#footer-kontak').innerHTML = kontak.length ? kontak.join('\n') : '<span style="opacity:.7">Data kontak belum diisi petugas.</span>';
  $('#footer-copy').textContent = '© ' + new Date().getFullYear() + ' ' + inst;
  document.title = uptd + ' - ' + inst;
  pasangCta();
}

// ---------- Data publik ----------
function muatData(paksa) {
  var basi = !AppState.data || (Date.now() - AppState.dataAt > 10 * 60 * 1000);
  if (AppState.data && !paksa && !AppState.dirty && !basi) return Promise.resolve(AppState.data);
  if (AppState.data && basi && !paksa && !AppState.dirty) {                  // segarkan diam-diam di latar belakang
    api('getPublicBundle').then(function (r) { if (r.success) { AppState.data = r.data; AppState.dataAt = Date.now(); } });
    AppState.dataAt = Date.now();
    return Promise.resolve(AppState.data);
  }
  return api('getPublicBundle').then(function (r) {
    if (!r.success) throw new Error(r.message || 'Gagal memuat data.');
    AppState.data = r.data; AppState.dataAt = Date.now(); AppState.dirty = false;
    terapkanBrand();
    return r.data;
  });
}

// ---------- Router SPA ----------
var HALAMAN = {};       // diisi pada bagian 2: nama halaman -> fungsi render(data, params)

function hancurkanChart() {
  AppState.charts.forEach(function (c) { try { c.destroy(); } catch (e) { /* abaikan */ } });
  AppState.charts = [];
}

/**
 * SATU-SATUNYA cara berpindah halaman. Tidak mengubah URL.
 * page: nama halaman publik | 'login' | 'admin'
 */
function navigateTo(page, opsi) {
  opsi = opsi || {};
  tutupDrawer();
  if (page === 'admin') {
    if (!AppState.token) { page = 'login'; }
    else { masukModeAdmin(); admNav(opsi.sub || AppState.adm.page || 'dashboard'); return; }
  }
  if (page === 'login' && AppState.token && AppState.user && !AppState.user.wajibGanti) { navigateTo('admin'); return; }
  keluarModeAdmin();
  if (!opsi.tanpaRiwayat && AppState.page) AppState.history.push({ page: AppState.page, params: AppState.params });
  if (AppState.history.length > 30) AppState.history.shift();
  AppState.page = page; AppState.params = opsi;
  document.body.classList.toggle('login-mode', page === 'login');
  hancurkanChart();
  aktifkanNav(page);
  var wadah = $('#app-container');
  wadah.innerHTML = '<div class="page-loading" role="status"><div class="spinner-blue" aria-hidden="true"></div><span>Memuat halaman&hellip;</span></div>';
  window.scrollTo(0, 0);

  if (page === 'login') { HALAMAN.login(wadah); sembunyikanOverlay(); return; }
  var fn = HALAMAN[page];
  if (!fn) { page = 'beranda'; fn = HALAMAN.beranda; AppState.page = page; }
  muatData().then(function (d) {
    if (AppState.page !== page) return;                 // pengguna sudah pindah
    fn(wadah, d, opsi);
    pasangCta();
    sembunyikanOverlay();
    try { wadah.focus({ preventScroll: true }); } catch (e) { /* abaikan */ }
  }).catch(function (e) {
    sembunyikanOverlay();
    wadah.innerHTML = '<div class="container-x page-body"><div class="empty"><i class="bi bi-wifi-off" aria-hidden="true"></i><p><strong>Halaman belum dapat dimuat.</strong><br>' + esc(e.message) +
      '</p><button type="button" class="btn btn-navy" onclick="navigateTo(\'' + esc(page) + '\',{tanpaRiwayat:true})">Coba lagi</button></div></div>';
  });
}
function kembali() {
  var h = AppState.history.pop();
  navigateTo(h ? h.page : 'beranda', { tanpaRiwayat: true, id: h && h.params ? h.params.id : undefined });
}
function sembunyikanOverlay() {
  var o = $('#loadingOverlay');
  if (o && !o.classList.contains('hide')) { o.classList.add('hide'); setTimeout(function () { o.style.display = 'none'; }, 350); }
}

// Delegasi klik kartu berita (data-berita) dan lightbox galeri
document.addEventListener('click', function (e) {
  var b = e.target.closest ? e.target.closest('[data-berita]') : null;
  if (b) { navigateTo('berita-detail', { id: b.dataset.berita }); }
});
document.addEventListener('keydown', function (e) {
  if (e.key === 'Enter' && e.target && e.target.dataset && e.target.dataset.berita) navigateTo('berita-detail', { id: e.target.dataset.berita });
});

// ---------- Inisialisasi ----------
document.addEventListener('DOMContentLoaded', function () {
  initTema();
  renderNav();
  terapkanBrand();
  if (window.__UNSUB__) navigateTo('berhenti', { token: window.__UNSUB__ });
  else navigateTo('beranda');
});

/* ==========================================================================
   Bagian 2: Halaman publik
   Setiap halaman: HALAMAN.nama = function (wadah, data, opsi)
   ========================================================================== */

function heroHalaman(judul, sub, crumb) {
  return '<section class="page-hero"><div class="container-x">' +
    '<nav class="crumb" aria-label="Jejak halaman"><a href="javascript:void(0)" onclick="navigateTo(\'beranda\')">Beranda</a><span>/</span><span>' + esc(crumb || judul) + '</span></nav>' +
    '<h1>' + esc(judul) + '</h1>' + (sub ? '<p>' + esc(sub) + '</p>' : '') + '</div></section>';
}
function bungkus(hero, isi) { return hero + '<div class="page-body"><div class="container-x">' + isi + '</div></div>'; }
function kosong(ikon, teks) { return '<div class="empty"><i class="bi ' + ikon + '" aria-hidden="true"></i><p class="mb-0">' + esc(teks) + '</p></div>'; }
function ctaDaftar(judul, teks) {
  return '<div class="cta-band mt-3"><div><h3>' + esc(judul) + '</h3><p>' + esc(teks) + '</p></div>' +
    '<a class="btn btn-gold" data-cta href="javascript:void(0)">Daftar Uji Online <i class="bi bi-box-arrow-up-right" aria-hidden="true"></i></a></div>';
}
function badgeJenis(j) { return '<span class="badge ' + (j === 'Pengumuman' ? 'b-gold' : 'b-info') + '">' + esc(j) + '</span>'; }

// ============================== BERANDA ==============================
HALAMAN.beranda = function (w, d) {
  var c = d.config;
  var hero = '<section class="hero"><div class="hero-art" aria-hidden="true"></div><div class="container-x"><div class="hero-in">' +
    '<span class="eyebrow">Website Resmi</span><h1>' + esc(c.nama_uptd) + '</h1>' +
    '<p class="hero-sub">' + esc(c.tagline || 'Informasi layanan pengujian berkala kendaraan bermotor: tarif, persyaratan, alur, regulasi, dan pengumuman resmi.') + '</p>' +
    '<div class="hero-actions"><a class="btn btn-gold" data-cta href="javascript:void(0)">Daftar Uji Online <i class="bi bi-box-arrow-up-right" aria-hidden="true"></i></a>' +
    '<button type="button" class="btn btn-outline" onclick="navigateTo(\'tarif\')">Lihat Layanan &amp; Tarif</button></div></div></div></section>';

  var quick = [
    ['tarif', 'bi-cash-coin', 'Layanan & Tarif', 'Jenis layanan uji dan tarifnya'],
    ['syarat', 'bi-list-check', 'Syarat & Alur', 'Persyaratan dan tahapan pengujian'],
    ['dokumen', 'bi-file-earmark-text', 'Regulasi & Dokumen', 'Unduh regulasi dan formulir'],
    ['kontak', 'bi-chat-dots', 'Kontak & Pengaduan', 'Sampaikan pertanyaan atau pengaduan']
  ].map(function (q) {
    return '<a href="javascript:void(0)" class="card card-hover quick" onclick="navigateTo(\'' + q[0] + '\')"><span class="quick-ico"><i class="bi ' + q[1] + '" aria-hidden="true"></i></span>' +
      '<span><h3>' + q[2] + '</h3><p>' + q[3] + '</p></span></a>';
  }).join('');

  var thn = tahunTersedia(d);
  if (!AppState.tahunStat || thn.indexOf(AppState.tahunStat) < 0) {
    var terbaru = null;
    thn.forEach(function (y) { var a = d.stat.uji[y]; if (a && a.some(function (n) { return n > 0; })) terbaru = y; });
    AppState.tahunStat = terbaru || thn[thn.length - 1] || null;
  }
  var statHtml;
  if (!thn.length) {
    statHtml = kosong('bi-bar-chart', 'Data statistik pengujian belum tersedia.');
  } else {
    statHtml = '<div id="stat-cards" class="stat-cards"></div><div class="grid cols-2">' +
      '<div class="card chart-card"><div class="chart-head"><h3>Kendaraan diuji per bulan</h3>' +
      '<label class="sr-only" for="pilih-tahun">Pilih tahun</label><select id="pilih-tahun" class="select chart-select" onchange="ubahTahunStat(this.value)">' +
      thn.slice().reverse().map(function (y) { return '<option value="' + y + '"' + (y === AppState.tahunStat ? ' selected' : '') + '>' + y + '</option>'; }).join('') +
      '</select></div><div class="chart-wrap"><canvas id="chart-uji" role="img" aria-label="Grafik batang jumlah kendaraan diuji per bulan"></canvas></div></div>' +
      '<div class="card chart-card"><div class="chart-head"><h3>Kendaraan wajib uji per tahun</h3></div>' +
      '<div class="chart-wrap"><canvas id="chart-wajib" role="img" aria-label="Grafik batang jumlah kendaraan wajib uji per tahun"></canvas></div></div></div>' +
      '<details class="mt-2"><summary style="cursor:pointer;font-weight:600">Lihat data dalam bentuk tabel</summary><div id="stat-tabel" class="mt-1"></div></details>';
  }

  var berita = d.berita.slice(0, 3);
  var beritaHtml = berita.length
    ? '<div class="news-grid g3">' + berita.map(kartuBerita).join('') + '</div>'
    : kosong('bi-newspaper', 'Belum ada berita atau pengumuman yang diterbitkan.');

  w.innerHTML = hero +
    '<div class="container-x quick-wrap"><div class="grid cols-4">' + quick + '</div></div>' +
    '<section class="section"><div class="container-x"><div class="section-head"><div><span class="eyebrow">Data Pengujian</span><h2>Statistik Pengujian Kendaraan</h2>' +
    '<p>Ringkasan jumlah kendaraan yang diuji dan kendaraan wajib uji.</p></div></div>' + statHtml + '</div></section>' +
    '<section class="section section-alt"><div class="container-x"><div class="section-head"><div><span class="eyebrow">Informasi Terkini</span><h2>Berita &amp; Pengumuman</h2></div>' +
    '<button type="button" class="btn btn-outline" onclick="navigateTo(\'berita\')">Lihat semua <i class="bi bi-arrow-right" aria-hidden="true"></i></button></div>' + beritaHtml + '</div></section>' +
    '<section class="section"><div class="container-x">' + ctaDaftar('Daftarkan kendaraan Anda untuk diuji', 'Pendaftaran pengujian dilakukan melalui sistem pendaftaran online. Tombol di samping akan membuka sistem tersebut di tab baru.') + '</div></section>';
  if (thn.length) isiStatistik();
};

function tahunTersedia(d) {
  var s = {};
  Object.keys(d.stat.uji).forEach(function (y) { s[y] = 1; });
  Object.keys(d.stat.wajib).forEach(function (y) { s[y] = 1; });
  return Object.keys(s).sort();
}
function ubahTahunStat(y) { AppState.tahunStat = y; isiStatistik(); }
function isiStatistik() {
  var d = AppState.data, y = AppState.tahunStat;
  if (!d || !y || !$('#stat-cards')) return;
  var arr = d.stat.uji[y] || [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  var total = arr.reduce(function (a, b) { return a + b; }, 0);
  var wajib = d.stat.wajib[y];
  var rasio = (wajib && wajib > 0) ? (Math.round(total / wajib * 1000) / 10).toLocaleString('id-ID') + '%' : '-';
  $('#stat-cards').innerHTML =
    '<div class="card stat"><div class="stat-n">' + fmtAngka(total) + '</div><div class="stat-l">Kendaraan diuji, tahun ' + esc(y) + '</div></div>' +
    '<div class="card stat"><div class="stat-n">' + (wajib ? fmtAngka(wajib) : '-') + '</div><div class="stat-l">Kendaraan wajib uji, tahun ' + esc(y) + '</div></div>' +
    '<div class="card stat"><div class="stat-n">' + rasio + '</div><div class="stat-l">Rasio diuji terhadap wajib uji</div></div>';
  var thn = tahunTersedia(d);
  $('#stat-tabel').innerHTML = '<div class="table-wrap"><table class="tbl"><thead><tr><th>Bulan (' + esc(y) + ')</th><th class="num">Diuji</th></tr></thead><tbody>' +
    arr.map(function (n, i) { return '<tr><td>' + BULAN[i] + '</td><td class="num">' + fmtAngka(n) + '</td></tr>'; }).join('') +
    '</tbody></table></div><div class="table-wrap mt-1"><table class="tbl"><thead><tr><th>Tahun</th><th class="num">Wajib uji</th></tr></thead><tbody>' +
    thn.map(function (t) { return '<tr><td>' + esc(t) + '</td><td class="num">' + (d.stat.wajib[t] !== undefined ? fmtAngka(d.stat.wajib[t]) : '-') + '</td></tr>'; }).join('') + '</tbody></table></div>';
  gambarChart();
}
function warnaCss(nama) { return getComputedStyle(document.documentElement).getPropertyValue(nama).trim(); }
function gambarChart() {
  hancurkanChart();
  var d = AppState.data, y = AppState.tahunStat;
  var c1 = $('#chart-uji'), c2 = $('#chart-wajib');
  if (!d || !c1) return;
  if (typeof Chart === 'undefined') {
    c1.parentNode.innerHTML = '<p class="text-muted">Grafik tidak dapat dimuat. Silakan lihat data pada tabel di bawah.</p>';
    if (c2) c2.parentNode.innerHTML = '';
    return;
  }
  var gelap = document.documentElement.getAttribute('data-theme') === 'dark';
  var teks = warnaCss('--muted'), garis = warnaCss('--border');
  var biru = gelap ? '#6ea0d8' : '#24527A', emas = gelap ? '#fdbf4a' : '#D49B28';
  var opsi = function (satuan) {
    return {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: function (x) { return fmtAngka(x.parsed.y) + ' ' + satuan; } } } },
      scales: {
        y: { beginAtZero: true, grid: { color: garis }, ticks: { color: teks, precision: 0, callback: function (v) { return fmtAngka(v); } } },
        x: { grid: { display: false }, ticks: { color: teks } }
      }
    };
  };
  AppState.charts.push(new Chart(c1, {
    type: 'bar',
    data: { labels: BULAN_PENDEK, datasets: [{ label: 'Kendaraan diuji', data: d.stat.uji[y] || [], backgroundColor: biru, borderRadius: 4 }] },
    options: opsi('kendaraan diuji')
  }));
  if (c2) {
    var th = Object.keys(d.stat.wajib).sort();
    AppState.charts.push(new Chart(c2, {
      type: 'bar',
      data: { labels: th, datasets: [{ label: 'Wajib uji', data: th.map(function (t) { return d.stat.wajib[t]; }), backgroundColor: emas, borderRadius: 4 }] },
      options: opsi('kendaraan wajib uji')
    }));
  }
}

// ============================== BERITA ==============================
function kartuBerita(b) {
  return '<article class="card card-hover news-card" tabindex="0" role="link" data-berita="' + esc(b.id) + '" aria-label="Baca: ' + esc(b.judul) + '">' +
    '<div class="news-img">' + (b.foto ? imgTag(b.foto, 640, '') : '<i class="bi bi-newspaper" aria-hidden="true"></i>') + '</div>' +
    '<div class="news-body"><div class="news-meta">' + badgeJenis(b.jenis) + '<span>' + fmtTanggal(b.tanggal) + '</span></div>' +
    '<h3>' + esc(b.judul) + '</h3><p>' + esc(b.ringkasan) + '</p></div></article>';
}

var FB = { jenis: 'Semua', q: '', tampil: 9 };
HALAMAN.berita = function (w, d, opsi) {
  if (!opsi.tanpaRiwayat) { FB = { jenis: 'Semua', q: '', tampil: 9 }; AppState.cariIds = {}; }
  w.innerHTML = bungkus(heroHalaman('Berita & Pengumuman', 'Informasi dan pengumuman resmi terbaru dari UPTD.', 'Berita'),
    '<div class="toolbar"><div class="search-box"><i class="bi bi-search" aria-hidden="true"></i><label class="sr-only" for="q-berita">Cari berita</label>' +
    '<input id="q-berita" class="input" type="search" placeholder="Cari judul atau isi berita" value="' + esc(FB.q) + '" oninput="cariBeritaInput(this.value)" maxlength="80"></div>' +
    '<div class="chip-row" id="chip-berita" role="group" aria-label="Filter jenis">' +
    ['Semua', 'Berita', 'Pengumuman'].map(function (j) { return '<button type="button" class="chip' + (FB.jenis === j ? ' active' : '') + '" onclick="filterBerita(\'' + j + '\')">' + j + '</button>'; }).join('') +
    '</div></div><div id="daftar-berita"></div>');
  isiBerita();
};
function filterBerita(j) {
  FB.jenis = j; FB.tampil = 9;
  $$('#chip-berita .chip').forEach(function (b) { b.classList.toggle('active', b.textContent === j); });
  isiBerita();
}
var cariServer = debounce(function (q) {
  if (q.length < 3) { AppState.cariIds = {}; isiBerita(); return; }
  api('cariBerita', q).then(function (r) {
    if (q !== FB.q) return;
    AppState.cariIds = {};
    if (r.success) r.data.forEach(function (id) { AppState.cariIds[id] = 1; });
    isiBerita();
  });
}, 500);
function cariBeritaInput(v) { FB.q = String(v || '').trim(); FB.tampil = 9; isiBerita(); cariServer(FB.q); }
function isiBerita() {
  var d = AppState.data, el = $('#daftar-berita');
  if (!d || !el) return;
  var q = FB.q.toLowerCase();
  var hasil = d.berita.filter(function (b) {
    if (FB.jenis !== 'Semua' && b.jenis !== FB.jenis) return false;
    if (!q) return true;
    return (b.judul + ' ' + b.ringkasan).toLowerCase().indexOf(q) >= 0 || AppState.cariIds[b.id];
  });
  if (!hasil.length) { el.innerHTML = kosong('bi-search', q ? 'Tidak ada berita yang cocok dengan pencarian Anda.' : 'Belum ada berita atau pengumuman.'); return; }
  el.innerHTML = '<div class="news-grid g3">' + hasil.slice(0, FB.tampil).map(kartuBerita).join('') + '</div>' +
    (hasil.length > FB.tampil ? '<div class="text-center mt-3"><button type="button" class="btn btn-outline" onclick="FB.tampil+=9;isiBerita()">Tampilkan lebih banyak</button></div>' : '');
}

HALAMAN['berita-detail'] = function (w, d, opsi) {
  var id = opsi.id;
  if (!id) { navigateTo('berita'); return; }
  api('getBeritaDetail', id).then(function (r) {
    if (AppState.page !== 'berita-detail') return;
    if (!r.success) {
      w.innerHTML = bungkus(heroHalaman('Berita tidak ditemukan', '', 'Berita'), kosong('bi-exclamation-circle', r.message) +
        '<div class="text-center mt-2"><button type="button" class="btn btn-navy" onclick="navigateTo(\'berita\')">Kembali ke daftar berita</button></div>');
      return;
    }
    var b = r.data;
    w.innerHTML = '<section class="page-hero"><div class="container-x"><nav class="crumb" aria-label="Jejak halaman"><a href="javascript:void(0)" onclick="navigateTo(\'beranda\')">Beranda</a><span>/</span>' +
      '<a href="javascript:void(0)" onclick="navigateTo(\'berita\')">Berita</a><span>/</span><span>Detail</span></nav><h1>' + esc(b.judul) + '</h1></div></section>' +
      '<div class="page-body"><div class="container-x"><article class="article">' +
      '<div class="news-meta">' + badgeJenis(b.jenis) + '<span><i class="bi bi-calendar3" aria-hidden="true"></i> ' + fmtTanggal(b.tanggal) + '</span>' +
      (b.penulis ? '<span><i class="bi bi-person" aria-hidden="true"></i> ' + esc(b.penulis) + '</span>' : '') + '</div>' +
      (b.foto ? '<div class="article-img">' + imgTag(b.foto, 1200, b.judul) + '</div>' : '') +
      '<div class="prose">' + renderTeks(b.isi) + '</div>' +
      '<div class="mt-3"><button type="button" class="btn btn-outline" onclick="kembali()"><i class="bi bi-arrow-left" aria-hidden="true"></i> Kembali</button></div></article></div></div>';
    window.scrollTo(0, 0);
  });
};

// ============================== HALAMAN TEKS ==============================
// Daftar halaman profil: [kunci, judul bawaan, ikon]. Dipakai menu publik, tab samping, dan tab admin.
var PROFIL_HAL = [
  ['sejarah', 'Sejarah', 'bi-clock-history'],
  ['profil', 'Profil UPTD', 'bi-building'],
  ['visi_misi', 'Visi dan Misi', 'bi-bullseye'],
  ['tugas_fungsi', 'Tugas dan Fungsi', 'bi-list-task'],
  ['sambutan', 'Sambutan Kepala UPTD', 'bi-person-vcard']
];
PROFIL_HAL.forEach(function (ph) {
  var key = ph[0];
  HALAMAN[key] = function (w, d) {
    var h = d.halaman[key] || { judul: '', isi: '' };
    var judul = h.judul || ph[1];
    var tabs = PROFIL_HAL;
    w.innerHTML = bungkus(heroHalaman(judul, '', 'Profil'),
      '<div class="split"><nav class="side-tabs side-sticky" aria-label="Halaman profil">' +
      tabs.map(function (t) { return '<a href="javascript:void(0)" class="' + (t[0] === key ? 'active' : '') + '" onclick="navigateTo(\'' + t[0] + '\')"><i class="bi ' + t[2] + '" aria-hidden="true"></i> ' + t[1] + '</a>'; }).join('') +
      '</nav><div class="card card-pad">' + (h.isi ? '<div class="prose">' + renderTeks(h.isi) + '</div>' : kosong('bi-file-text', 'Konten halaman ini belum diisi oleh petugas.')) + '</div></div>');
  };
});

// ============================== ORGANISASI ==============================
function kartuOrang(o) {
  return '<article class="card card-hover person"><div class="person-photo">' + (o.foto ? imgTag(o.foto, 480, o.nama) : '<i class="bi bi-person-fill" aria-hidden="true"></i>') + '</div>' +
    '<div class="person-body"><h3>' + esc(o.nama) + '</h3><p>' + esc(o.jabatan) + '</p></div></article>';
}
HALAMAN.pejabat = function (w, d) {
  w.innerHTML = bungkus(heroHalaman('Pejabat & Pegawai', 'Susunan pejabat struktural dan pegawai UPTD.', 'Organisasi'),
    '<div class="section-head"><h2>Pejabat Struktural</h2></div>' +
    (d.pejabat.length ? '<div class="person-grid">' + d.pejabat.map(kartuOrang).join('') + '</div>' : kosong('bi-people', 'Data pejabat belum diisi.')) +
    '<div class="section-head mt-3" style="margin-top:40px"><h2>Pegawai</h2></div>' +
    '<div class="toolbar"><div class="search-box"><i class="bi bi-search" aria-hidden="true"></i><label class="sr-only" for="q-pegawai">Cari pegawai</label>' +
    '<input id="q-pegawai" class="input" type="search" placeholder="Cari nama atau bagian" oninput="isiPegawai()" maxlength="80"></div></div><div id="daftar-pegawai"></div>');
  isiPegawai();
};
function isiPegawai() {
  var d = AppState.data, el = $('#daftar-pegawai'); if (!d || !el) return;
  var q = ($('#q-pegawai') ? $('#q-pegawai').value : '').toLowerCase().trim();
  var h = d.pegawai.filter(function (p) { return !q || (p.nama + ' ' + p.jabatan).toLowerCase().indexOf(q) >= 0; });
  el.innerHTML = h.length ? '<div class="person-grid">' + h.map(kartuOrang).join('') + '</div>' : kosong('bi-people', q ? 'Tidak ada pegawai yang cocok.' : 'Data pegawai belum diisi.');
}

// Bagan dibangun OTOMATIS dari data Pejabat & Pegawai (Sheets). Pejabat urutan pertama = pimpinan
// (kotak teratas), pejabat berikutnya di sisi kanan batang, seluruh pegawai di bawah "Petugas Operasional".
// Urutan dan foto diatur petugas lewat menu Pejabat / Pegawai di panel pengelolaan.
function orgAva(o, ukuran) {
  return '<span class="org-ava org-ava-' + ukuran + '">' +
    (o.foto ? imgTag(o.foto, ukuran === 'lg' ? 200 : 140, o.nama) : '<i class="bi bi-person-fill" aria-hidden="true"></i>') + '</span>';
}
function orgKartu(o, kelas, ukuran) {
  return '<div class="org-card ' + kelas + '">' + orgAva(o, ukuran) +
    '<strong class="org-nama">' + esc(o.nama) + '</strong><span class="org-jab">' + esc(o.jabatan) + '</span></div>';
}
HALAMAN.bagan = function (w, d) {
  var pj = d.pejabat || [], pg = d.pegawai || [];
  var id = d.config.bagan_file_id;
  var isi = '';
  if (!pj.length && !pg.length) {
    isi = kosong('bi-diagram-3', 'Data pejabat dan pegawai belum diisi oleh petugas.');
  } else {
    isi = '<div class="org"><div class="org-body">';
    if (pj.length) isi += '<div class="org-top">' + orgKartu(pj[0], 'org-utama', 'lg') + '</div>';
    pj.slice(1).forEach(function (o) { isi += '<div class="org-side">' + orgKartu(o, '', 'md') + '</div>'; });
    if (pg.length) {
      isi += '<div class="org-label"><span>Petugas Operasional</span><b>' + fmtAngka(pg.length) + ' orang</b></div>' +
        '<ul class="org-staff">' + pg.map(function (o) { return '<li>' + orgKartu(o, '', 'sm') + '</li>'; }).join('') + '</ul>';
    }
    isi += '</div></div>';
  }
  if (id) {
    isi += '<div class="card card-pad mt-3"><h2>Bagan dalam bentuk gambar</h2>' +
      '<button type="button" class="w-100" style="border:0;background:none;padding:0;cursor:zoom-in" onclick="bukaBagan()" aria-label="Perbesar bagan organisasi">' +
      '<div class="article-img" style="margin:0">' + imgTag(id, 1400, 'Bagan organisasi') + '</div></button>' +
      '<p class="hint text-center mt-1 mb-0"><i class="bi bi-zoom-in" aria-hidden="true"></i> Klik gambar untuk memperbesar</p></div>';
  }
  w.innerHTML = bungkus(heroHalaman('Bagan Organisasi', 'Struktur organisasi UPTD Pengujian Kendaraan Bermotor.', 'Organisasi'), isi);
};
function bukaBagan() { bukaLightbox([{ id: AppState.data.config.bagan_file_id, judul: 'Bagan Organisasi' }], 0); }

// ============================== LAYANAN & TARIF ==============================
HALAMAN.tarif = function (w, d) {
  var jenis = [];
  d.layanan.forEach(function (l) { if (l.jenis && jenis.indexOf(l.jenis) < 0) jenis.push(l.jenis); });
  w.innerHTML = bungkus(heroHalaman('Layanan & Tarif Uji', 'Daftar layanan pengujian dan tarifnya.', 'Layanan & Tarif'),
    (d.layanan.length ? '<div class="toolbar"><div class="search-box"><i class="bi bi-search" aria-hidden="true"></i><label class="sr-only" for="q-tarif">Cari layanan</label>' +
      '<input id="q-tarif" class="input" type="search" placeholder="Cari layanan atau jenis kendaraan" oninput="isiTarif()" maxlength="80"></div>' +
      '<label class="sr-only" for="f-jenis">Filter jenis kendaraan</label><select id="f-jenis" class="select" onchange="isiTarif()"><option value="">Semua jenis kendaraan</option>' +
      jenis.map(function (j) { return '<option>' + esc(j) + '</option>'; }).join('') + '</select></div><div id="tabel-tarif"></div>'
      : kosong('bi-cash-coin', 'Data layanan dan tarif belum diisi oleh petugas.')) +
    ctaDaftar('Siap menguji kendaraan?', 'Lihat juga syarat dan alur pengujian, lalu lakukan pendaftaran melalui sistem online.'));
  if (d.layanan.length) isiTarif();
};
function isiTarif() {
  var d = AppState.data, el = $('#tabel-tarif'); if (!d || !el) return;
  var q = ($('#q-tarif').value || '').toLowerCase().trim(), j = $('#f-jenis').value;
  var h = d.layanan.filter(function (l) {
    return (!j || l.jenis === j) && (!q || (l.layanan + ' ' + l.jenis + ' ' + l.dasar + ' ' + l.ket).toLowerCase().indexOf(q) >= 0);
  });
  if (!h.length) { el.innerHTML = kosong('bi-search', 'Tidak ada layanan yang cocok dengan pencarian.'); return; }
  el.innerHTML = '<div class="table-wrap"><table class="tbl tbl-resp"><thead><tr><th>Layanan</th><th>Jenis Kendaraan</th><th>Tarif</th><th>Dasar Hukum</th><th>Keterangan</th></tr></thead><tbody>' +
    h.map(function (l) {
      return '<tr><td data-label="Layanan"><strong>' + esc(l.layanan) + '</strong></td><td data-label="Jenis kendaraan">' + esc(l.jenis || '-') + '</td>' +
        '<td data-label="Tarif" class="tarif">' + esc(l.tarif || '-') + '</td><td data-label="Dasar hukum">' + esc(l.dasar || '-') + '</td><td data-label="Keterangan">' + esc(l.ket || '-') + '</td></tr>';
    }).join('') + '</tbody></table></div>';
}

HALAMAN.syarat = function (w, d) {
  var syarat = d.syarat.length
    ? '<ol class="checklist">' + d.syarat.map(function (s, i) {
      return '<li class="card"><span class="check-no">' + (i + 1) + '</span><div><strong>' + esc(s.judul) + '</strong>' + (s.deskripsi ? '<div class="text-muted" style="font-size:14px">' + esc(s.deskripsi) + '</div>' : '') + '</div></li>';
    }).join('') + '</ol>' : kosong('bi-list-check', 'Persyaratan belum diisi oleh petugas.');
  var alur = d.alur.length
    ? '<ol class="steps">' + d.alur.map(function (s, i) {
      return '<li class="step"><span class="step-no">' + (i + 1) + '</span><div><h3>' + esc(s.judul) + '</h3>' + (s.deskripsi ? '<p>' + esc(s.deskripsi) + '</p>' : '') + '</div></li>';
    }).join('') + '</ol>' : kosong('bi-signpost-split', 'Alur pengujian belum diisi oleh petugas.');
  w.innerHTML = bungkus(heroHalaman('Syarat & Alur Pengujian', 'Persyaratan dan tahapan yang perlu Anda ikuti.', 'Layanan & Tarif'),
    '<div class="grid cols-2" style="align-items:start"><section><div class="section-head"><h2>Persyaratan</h2></div>' + syarat + '</section>' +
    '<section><div class="section-head"><h2>Alur Pengujian</h2></div><div class="card card-pad">' + alur + '</div></section></div>' +
    ctaDaftar('Sudah memahami syarat dan alurnya?', 'Lanjutkan dengan mendaftar melalui sistem pendaftaran online.'));
};

// ============================== DOKUMEN ==============================
var FD = { kat: 'Semua', q: '' };
HALAMAN.dokumen = function (w, d) {
  FD = { kat: 'Semua', q: '' };
  w.innerHTML = bungkus(heroHalaman('Regulasi & Dokumen', 'Unduh regulasi, dokumen pelayanan, dan formulir.', 'Regulasi & Dokumen'),
    '<div class="toolbar"><div class="search-box"><i class="bi bi-search" aria-hidden="true"></i><label class="sr-only" for="q-dok">Cari dokumen</label>' +
    '<input id="q-dok" class="input" type="search" placeholder="Cari judul atau nomor dokumen" oninput="FD.q=this.value.toLowerCase().trim();isiDokumen()" maxlength="80"></div>' +
    '<div class="chip-row" id="chip-dok" role="group" aria-label="Filter kategori">' +
    ['Semua', 'Regulasi', 'Pelayanan', 'Formulir'].map(function (k) { return '<button type="button" class="chip' + (k === 'Semua' ? ' active' : '') + '" onclick="filterDokumen(\'' + k + '\')">' + k + '</button>'; }).join('') +
    '</div></div><div id="daftar-dok"></div>');
  isiDokumen();
};
function filterDokumen(k) {
  FD.kat = k;
  $$('#chip-dok .chip').forEach(function (b) { b.classList.toggle('active', b.textContent === k); });
  isiDokumen();
}
function isiDokumen() {
  var d = AppState.data, el = $('#daftar-dok'); if (!d || !el) return;
  var h = d.dokumen.filter(function (x) {
    return (FD.kat === 'Semua' || x.kategori === FD.kat) && (!FD.q || (x.judul + ' ' + x.nomor).toLowerCase().indexOf(FD.q) >= 0);
  });
  if (!h.length) { el.innerHTML = kosong('bi-file-earmark-x', FD.q || FD.kat !== 'Semua' ? 'Tidak ada dokumen yang cocok.' : 'Belum ada dokumen yang dipublikasikan.'); return; }
  el.innerHTML = '<div class="doc-list">' + h.map(function (x) {
    return '<div class="card doc-row"><span class="doc-ico"><i class="bi bi-file-earmark-pdf" aria-hidden="true"></i></span>' +
      '<div class="doc-info"><h3>' + esc(x.judul) + '</h3><div class="doc-meta"><span class="badge b-info">' + esc(x.kategori) + '</span>' +
      (x.nomor ? '<span>' + esc(x.nomor) + '</span>' : '') + (x.tanggal ? '<span>' + fmtTanggal(x.tanggal) + '</span>' : '') + '</div></div>' +
      '<div class="doc-actions"><button type="button" class="btn btn-outline btn-sm" onclick="lihatDokumen(\'' + esc(x.id) + '\')"><i class="bi bi-eye" aria-hidden="true"></i> Lihat</button>' +
      '<a class="btn btn-navy btn-sm" href="' + urlUnduh(x.file) + '" target="_blank" rel="noopener noreferrer"><i class="bi bi-download" aria-hidden="true"></i> Unduh</a></div></div>';
  }).join('') + '</div>';
}
function lihatDokumen(id) {
  var x = null;
  AppState.data.dokumen.forEach(function (o) { if (o.id === id) x = o; });
  if (!x) return;
  bukaModal({
    judul: x.judul, lebar: 'xl',
    isi: '<iframe class="pdf-frame" title="Pratinjau ' + esc(x.judul) + '" src="' + urlPratinjauPdf(x.file) + '"></iframe>' +
      '<p class="hint mb-0">Bila pratinjau tidak tampil, gunakan tombol Unduh.</p>',
    footer: '<button type="button" class="btn btn-outline" onclick="tutupModalTeratas()">Tutup</button>' +
      '<a class="btn btn-navy" href="' + urlUnduh(x.file) + '" target="_blank" rel="noopener noreferrer"><i class="bi bi-download" aria-hidden="true"></i> Unduh</a>'
  });
}

// ============================== GALERI & LIGHTBOX ==============================
var FG = { album: 'Semua' };
HALAMAN.galeri = function (w, d) {
  FG = { album: 'Semua' };
  var album = ['Semua'];
  d.galeri.forEach(function (g) { var a = g.album || 'Umum'; if (album.indexOf(a) < 0) album.push(a); });
  w.innerHTML = bungkus(heroHalaman('Galeri Foto', 'Dokumentasi kegiatan dan layanan UPTD.', 'Galeri'),
    (d.galeri.length ? '<div class="chip-row mb-2" id="chip-album" role="group" aria-label="Filter album">' +
      album.map(function (a, i) { return '<button type="button" class="chip' + (i === 0 ? ' active' : '') + '" data-album="' + esc(a) + '">' + esc(a) + '</button>'; }).join('') + '</div><div id="grid-galeri"></div>'
      : kosong('bi-images', 'Belum ada foto pada galeri.')));
  $$('#chip-album .chip').forEach(function (b) {
    b.addEventListener('click', function () {
      FG.album = b.dataset.album;
      $$('#chip-album .chip').forEach(function (x) { x.classList.toggle('active', x === b); });
      isiGaleri();
    });
  });
  if (d.galeri.length) isiGaleri();
};
function galeriTersaring() {
  return AppState.data.galeri.filter(function (g) { return FG.album === 'Semua' || (g.album || 'Umum') === FG.album; });
}
function isiGaleri() {
  var h = galeriTersaring();
  $('#grid-galeri').innerHTML = '<div class="gal-grid">' + h.map(function (g, i) {
    return '<button type="button" class="gal-item" onclick="bukaGaleri(' + i + ')" aria-label="Perbesar foto: ' + esc(g.judul) + '">' + imgTag(g.file, 520, g.judul) +
      '<span class="gal-cap">' + esc(g.judul) + '</span></button>';
  }).join('') + '</div>';
}
function bukaGaleri(i) {
  bukaLightbox(galeriTersaring().map(function (g) { return { id: g.file, judul: g.judul, ket: g.ket }; }), i);
}

var _lb = { items: [], i: 0, z: 1 };
function bukaLightbox(items, i) {
  tutupLightbox();
  _lb = { items: items, i: i || 0, z: 1 };
  var el = document.createElement('div');
  el.id = 'lightbox'; el.className = 'lightbox'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Pratinjau gambar');
  el.innerHTML = '<div class="lb-top"><strong id="lb-judul" style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></strong><div class="flex gap-1">' +
    '<button type="button" class="icon-btn" onclick="zoomLightbox(-1)" aria-label="Perkecil"><i class="bi bi-zoom-out" aria-hidden="true"></i></button>' +
    '<button type="button" class="icon-btn" onclick="zoomLightbox(1)" aria-label="Perbesar"><i class="bi bi-zoom-in" aria-hidden="true"></i></button>' +
    '<button type="button" class="icon-btn" onclick="zoomLightbox(0)" aria-label="Ukuran asli"><i class="bi bi-arrows-angle-contract" aria-hidden="true"></i></button>' +
    '<button type="button" class="icon-btn" onclick="tutupLightbox()" aria-label="Tutup"><i class="bi bi-x-lg" aria-hidden="true"></i></button></div></div>' +
    '<div class="lb-stage" id="lb-stage"><button type="button" class="lb-nav prev" onclick="geserLightbox(-1)" aria-label="Sebelumnya"><i class="bi bi-chevron-left" aria-hidden="true"></i></button><img id="lb-img" alt="">' +
    '<button type="button" class="lb-nav next" onclick="geserLightbox(1)" aria-label="Berikutnya"><i class="bi bi-chevron-right" aria-hidden="true"></i></button></div><div class="lb-cap" id="lb-cap"></div>';
  document.body.appendChild(el);
  document.body.classList.add('no-scroll');
  tampilLightbox();
}
function tampilLightbox() {
  var it = _lb.items[_lb.i]; if (!it) return;
  var img = $('#lb-img');
  img.onerror = function () { gambarFallback(img); };
  img.dataset.fb = ''; img.dataset.id = it.id; img.dataset.w = 1600;
  img.src = urlGambar(it.id, 1600); img.alt = it.judul || '';
  $('#lb-judul').textContent = it.judul || '';
  $('#lb-cap').textContent = (it.ket ? it.ket + ' ' : '') + (_lb.items.length > 1 ? '(' + (_lb.i + 1) + ' dari ' + _lb.items.length + ')' : '');
  $$('.lb-nav').forEach(function (b) { b.style.display = _lb.items.length > 1 ? '' : 'none'; });
  zoomLightbox(0);
}
function geserLightbox(n) {
  if (_lb.items.length < 2) return;
  _lb.i = (_lb.i + n + _lb.items.length) % _lb.items.length;
  tampilLightbox();
}
function zoomLightbox(n) {
  _lb.z = n === 0 ? 1 : Math.min(4, Math.max(1, _lb.z + n));
  var st = $('#lb-stage'), img = $('#lb-img'); if (!st) return;
  st.classList.toggle('zoomed', _lb.z > 1);
  img.style.width = _lb.z > 1 ? (_lb.z * 100) + '%' : '';
}
function tutupLightbox() {
  var el = $('#lightbox'); if (el) el.parentNode.removeChild(el);
  if (!_modals.length) document.body.classList.remove('no-scroll');
}

// ============================== KONTAK & PENGADUAN ==============================
var KENDARAAN = ['Mobil penumpang', 'Mobil bus', 'Mobil barang (truk)', 'Kendaraan khusus', 'Kereta gandengan / tempelan', 'Lainnya'];
HALAMAN.kontak = function (w, d) {
  var c = d.config;
  function info(ikon, judul, isi, tautan) {
    return '<div class="card info-card"><span class="quick-ico"><i class="bi ' + ikon + '" aria-hidden="true"></i></span><div><h3>' + judul + '</h3>' +
      (isi ? '<p>' + (tautan ? '<a href="' + tautan + '" target="_blank" rel="noopener noreferrer">' + esc(isi) + '</a>' : esc(isi)) + '</p>' : '<p class="text-muted">Belum diisi petugas.</p>') + '</div></div>';
  }
  var telHref = c.telepon ? 'tel:' + esc(c.telepon.replace(/[^\d+]/g, '')) : '';
  var mailHref = c.email_kontak ? 'mailto:' + esc(c.email_kontak) : '';
  w.innerHTML = bungkus(heroHalaman('Kontak & Pengaduan', 'Hubungi kami atau sampaikan pengaduan Anda.', 'Kontak'),
    '<div class="contact-grid"><div><div class="info-list">' +
    info('bi-geo-alt', 'Alamat', c.alamat) + info('bi-telephone', 'Telepon', c.telepon, telHref) +
    info('bi-envelope', 'Email', c.email_kontak, mailHref) + info('bi-clock', 'Jam layanan', c.jam_layanan) + '</div>' +
    (c.peta_lokasi ? '<div class="mt-2"><iframe class="map-frame" title="Peta lokasi ' + esc(c.nama_uptd) + '" loading="lazy" referrerpolicy="no-referrer-when-downgrade" src="' + esc(c.peta_lokasi) + '"></iframe></div>' : '') +
    '</div>' +
    '<div class="card card-pad"><h2>Formulir Kontak &amp; Pengaduan</h2><p class="text-muted">Semua kolom wajib diisi.</p>' +
    '<form id="form-pesan" onsubmit="kirimPesan(event)" novalidate>' +
    '<div class="field"><span class="label">Jenis pesan <span class="req">*</span></span><div class="radio-cards">' +
    '<div class="radio-card"><input type="radio" name="jenis" id="j-kontak" value="Kontak" checked><label for="j-kontak"><i class="bi bi-chat-dots" aria-hidden="true"></i> Kontak</label></div>' +
    '<div class="radio-card"><input type="radio" name="jenis" id="j-adu" value="Pengaduan"><label for="j-adu"><i class="bi bi-megaphone" aria-hidden="true"></i> Pengaduan</label></div></div></div>' +
    '<div class="form-2"><div class="field"><label class="label" for="p-nama">Nama <span class="req">*</span></label><input id="p-nama" name="nama" class="input" maxlength="100" autocomplete="name"><div class="field-err" data-err="nama"></div></div>' +
    '<div class="field"><label class="label" for="p-hp">No. HP <span class="req">*</span></label><input id="p-hp" name="hp" class="input" inputmode="tel" maxlength="25" placeholder="081234567890" autocomplete="tel"><div class="field-err" data-err="hp"></div></div></div>' +
    '<div class="form-2"><div class="field"><label class="label" for="p-email">Email <span class="req">*</span></label><input id="p-email" name="email" type="email" class="input" maxlength="120" autocomplete="email"><div class="field-err" data-err="email"></div></div>' +
    '<div class="field"><label class="label" for="p-kend">Jenis kendaraan <span class="req">*</span></label><input id="p-kend" name="kendaraan" class="input" list="dl-kend" maxlength="60" placeholder="Pilih atau ketik"><datalist id="dl-kend">' +
    KENDARAAN.map(function (k) { return '<option value="' + esc(k) + '">'; }).join('') + '</datalist><div class="field-err" data-err="kendaraan"></div></div></div>' +
    '<div class="field"><label class="label" for="p-isi">Isi pesan <span class="req">*</span></label><textarea id="p-isi" name="isi" class="textarea" maxlength="2000" oninput="$(\'#cnt-isi\').textContent=this.value.length"></textarea>' +
    '<div class="hint"><span id="cnt-isi">0</span>/2000 karakter</div><div class="field-err" data-err="isi"></div></div>' +
    '<div class="honeypot" aria-hidden="true"><label>Jangan diisi<input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>' +
    '<p class="hint"><i class="bi bi-shield-check" aria-hidden="true"></i> Data Anda hanya digunakan untuk menindaklanjuti pesan ini dan tidak ditampilkan kepada publik.</p>' +
    '<button type="submit" class="btn btn-gold btn-block" id="btn-kirim"><i class="bi bi-send" aria-hidden="true"></i> Kirim pesan</button></form></div></div>');
};

function kirimPesan(e) {
  e.preventDefault();
  var f = e.target;
  var v = {
    jenis: f.jenis.value, nama: f.nama.value.trim(), hp: f.hp.value.trim(), email: f.email.value.trim(),
    kendaraan: f.kendaraan.value.trim(), isi: f.isi.value.trim(), website: f.website.value
  };
  var err = {};
  if (v.nama.length < 3) err.nama = 'Nama minimal 3 karakter.';
  if (!/^(\+?62|0)[0-9]{8,13}$/.test(v.hp.replace(/[\s\-().]/g, ''))) err.hp = 'Nomor HP tidak valid. Contoh: 081234567890.';
  if (!/^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/.test(v.email)) err.email = 'Format email tidak valid.';
  if (v.kendaraan.length < 2) err.kendaraan = 'Jenis kendaraan wajib diisi.';
  if (v.isi.length < 10) err.isi = 'Isi pesan minimal 10 karakter.';
  $$('[data-err]', f).forEach(function (el) { el.textContent = err[el.dataset.err] || ''; });
  $$('.input, .textarea', f).forEach(function (el) { el.classList.toggle('err', !!err[el.name]); });
  var pertama = Object.keys(err)[0];
  if (pertama) { f[pertama].focus(); toast('Periksa kembali isian yang ditandai.', 'warning'); return; }
  var btn = $('#btn-kirim');
  sibuk(btn, true, 'Mengirim...');
  api('submitPesan', v).then(function (r) {
    sibuk(btn, false);
    if (r.success) { navigateTo('konfirmasi', { kode: r.data.kode, nama: v.nama, email: v.email }); }
    else toast(r.message, 'error');
  });
}

HALAMAN.konfirmasi = function (w, d, opsi) {
  if (!opsi.kode) { navigateTo('kontak'); return; }
  w.innerHTML = bungkus(heroHalaman('Pesan Terkirim', '', 'Kontak'),
    '<div class="card done-box"><div class="done-ico"><i class="bi bi-check-lg" aria-hidden="true"></i></div><h2>Terima kasih, ' + esc(opsi.nama || '') + '</h2>' +
    '<p>Pesan Anda telah kami terima dengan nomor tiket:</p><div class="ticket">' + esc(opsi.kode) + '</div>' +
    '<p class="text-muted">Balasan otomatis dikirim ke <strong>' + esc(opsi.email || 'email Anda') + '</strong>. Simpan nomor tiket ini bila Anda perlu menghubungi kami kembali.</p>' +
    '<button type="button" class="btn btn-navy" onclick="navigateTo(\'beranda\')">Kembali ke beranda</button></div>');
};

// ============================== LANGGANAN ==============================
function submitLangganan(e) {
  e.preventDefault();
  var inp = $('#sub-email'), email = inp.value.trim();
  if (!/^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/.test(email)) { toast('Format email tidak valid.', 'warning'); inp.focus(); return; }
  var btn = $('#btn-langganan');
  sibuk(btn, true, 'Mengirim...');
  api('subscribe', email).then(function (r) {
    sibuk(btn, false);
    if (r.success) { toast(r.message, 'success'); inp.value = ''; } else toast(r.message, 'error');
  });
}

HALAMAN.berhenti = function (w, d, opsi) {
  w.innerHTML = bungkus(heroHalaman('Berhenti Berlangganan', '', 'Berhenti Berlangganan'),
    '<div class="card done-box" id="box-unsub"><div class="spinner-blue" style="margin:0 auto 12px" aria-hidden="true"></div><p>Memproses permintaan Anda&hellip;</p></div>');
  api('unsubscribe', opsi.token || window.__UNSUB__).then(function (r) {
    var box = $('#box-unsub'); if (!box) return;
    box.innerHTML = '<div class="done-ico" style="' + (r.success ? '' : 'background:var(--bad-bg);color:var(--bad)') + '"><i class="bi ' + (r.success ? 'bi-check-lg' : 'bi-x-lg') + '" aria-hidden="true"></i></div>' +
      '<h2>' + (r.success ? 'Berhasil' : 'Tidak dapat diproses') + '</h2><p>' + esc(r.message) + '</p>' +
      '<button type="button" class="btn btn-navy" onclick="window.__UNSUB__=\'\';navigateTo(\'beranda\')">Ke beranda</button>';
  });
};

/* ==========================================================================
   Bagian 3: Login & panel pengelolaan petugas
   ========================================================================== */

// ============================== LOGIN ==============================
HALAMAN.login = function (w) {
  var c = (AppState.data && AppState.data.config) || {};
  w.innerHTML = '<div class="login-wrap"><div class="login-card"><span class="brand-logo">' + logoHtml(c) + '</span>' +
    '<h1>Login Petugas</h1><p class="sub">' + esc(c.nama_uptd || 'UPTD Pengujian Kendaraan Bermotor') + '</p>' +
    '<form id="form-login" onsubmit="prosesLogin(event)" novalidate>' +
    '<div class="field"><label class="label" for="l-user">Nama pengguna</label><input id="l-user" name="u" class="input" autocomplete="username" autocapitalize="none" maxlength="40" required></div>' +
    '<div class="field"><label class="label" for="l-pass">Kata sandi</label><div class="pw-wrap"><input id="l-pass" name="p" type="password" class="input" autocomplete="current-password" maxlength="100" required>' +
    '<button type="button" onclick="tampilSandi(\'l-pass\',this)" aria-label="Tampilkan kata sandi"><i class="bi bi-eye" aria-hidden="true"></i></button></div></div>' +
    '<div id="login-err" class="alert alert-danger" role="alert" hidden></div>' +
    '<button type="submit" class="btn btn-navy btn-block mt-2" id="btn-login">Masuk</button></form>' +
    '<p class="text-center mt-2 mb-0"><a href="javascript:void(0)" onclick="navigateTo(\'beranda\')">&larr; Kembali ke website</a></p></div></div>';
  var u = $('#l-user'); if (u) u.focus();
};
function tampilSandi(id, btn) {
  var i = document.getElementById(id); if (!i) return;
  var lihat = i.type === 'password';
  i.type = lihat ? 'text' : 'password';
  btn.innerHTML = '<i class="bi ' + (lihat ? 'bi-eye-slash' : 'bi-eye') + '" aria-hidden="true"></i>';
  btn.setAttribute('aria-label', lihat ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi');
}
function prosesLogin(e) {
  e.preventDefault();
  var f = e.target, err = $('#login-err'), btn = $('#btn-login');
  err.hidden = true;
  if (!f.u.value.trim() || !f.p.value) { err.textContent = 'Nama pengguna dan kata sandi wajib diisi.'; err.hidden = false; return; }
  sibuk(btn, true, 'Memeriksa...');
  api('login', f.u.value.trim(), f.p.value).then(function (r) {
    sibuk(btn, false);
    if (!r.success) { err.textContent = r.message; err.hidden = false; f.p.value = ''; f.p.focus(); return; }
    AppState.token = r.data.token;
    AppState.user = { username: r.data.username, nama: r.data.nama, wajibGanti: r.data.wajibGanti };
    if (r.data.wajibGanti) { tampilGantiWajib(); return; }
    toast('Selamat datang, ' + r.data.nama + '.', 'success');
    navigateTo('admin', { sub: 'dashboard' });
  });
}

var _gantiTampil = false;
function formSandiHtml(wajib) {
  return (wajib ? '<div class="alert alert-warn mb-2"><i class="bi bi-exclamation-triangle" aria-hidden="true"></i><span>Demi keamanan, Anda wajib mengganti kata sandi sementara sebelum melanjutkan.</span></div>' : '') +
    '<form id="form-sandi" novalidate>' +
    '<div class="field"><label class="label" for="s-lama">' + (wajib ? 'Kata sandi sementara' : 'Kata sandi lama') + '</label><input id="s-lama" type="password" class="input" autocomplete="current-password" maxlength="100"></div>' +
    '<div class="field"><label class="label" for="s-baru">Kata sandi baru</label><input id="s-baru" type="password" class="input" autocomplete="new-password" maxlength="100"><div class="hint">Minimal 8 karakter, mengandung huruf dan angka.</div></div>' +
    '<div class="field"><label class="label" for="s-ulang">Ulangi kata sandi baru</label><input id="s-ulang" type="password" class="input" autocomplete="new-password" maxlength="100"></div>' +
    '<div id="s-err" class="alert alert-danger" role="alert" hidden></div></form>';
}
function kirimGantiSandi(m, wajib) {
  var lama = $('#s-lama').value, baru = $('#s-baru').value, ulang = $('#s-ulang').value, err = $('#s-err');
  err.hidden = true;
  var pesan = '';
  if (!lama) pesan = 'Kata sandi lama wajib diisi.';
  else if (baru.length < 8 || !/[A-Za-z]/.test(baru) || !/[0-9]/.test(baru)) pesan = 'Kata sandi baru minimal 8 karakter dan mengandung huruf serta angka.';
  else if (baru !== ulang) pesan = 'Konfirmasi kata sandi tidak sama.';
  if (pesan) { err.textContent = pesan; err.hidden = false; return; }
  var btn = $('[data-simpan]', m.foot);
  sibuk(btn, true, 'Menyimpan...');
  apiA('changePassword', lama, baru).then(function (r) {
    sibuk(btn, false);
    if (!r.success) { if (r.code !== 'SESI') { err.textContent = r.message; err.hidden = false; } return; }
    AppState.user.wajibGanti = false; _gantiTampil = false;
    m.tutup();
    toast(r.message || 'Kata sandi berhasil diganti.', 'success');
    if (wajib) navigateTo('admin', { sub: 'dashboard' });
  });
}
function tampilGantiWajib() {
  if (_gantiTampil) return;
  _gantiTampil = true;
  var m = bukaModal({
    judul: 'Ganti Kata Sandi', statis: true, isi: formSandiHtml(true),
    footer: '<button type="button" class="btn btn-outline" data-keluar>Keluar</button><button type="button" class="btn btn-navy" data-simpan>Simpan kata sandi</button>',
    onTutup: function () { _gantiTampil = false; }
  });
  $('[data-simpan]', m.foot).addEventListener('click', function () { kirimGantiSandi(m, true); });
  $('[data-keluar]', m.foot).addEventListener('click', function () { m.tutup(); admLogout(); });
}
function bukaGantiSandi() {
  var m = bukaModal({
    judul: 'Ganti Kata Sandi', isi: formSandiHtml(false),
    footer: '<button type="button" class="btn btn-outline" onclick="tutupModalTeratas()">Batal</button><button type="button" class="btn btn-navy" data-simpan>Simpan</button>'
  });
  $('[data-simpan]', m.foot).addEventListener('click', function () { kirimGantiSandi(m, false); });
}

function sesiBerakhir() {
  if (!AppState.token) return;
  AppState.token = null; AppState.user = null;
  while (_modals.length) _modals[_modals.length - 1].tutup();
  resetShellAdmin();
  toast('Sesi Anda telah berakhir. Silakan masuk kembali.', 'warning');
  navigateTo('login', { tanpaRiwayat: true });
}
function admLogout() {
  var t = AppState.token;
  AppState.token = null; AppState.user = null;
  resetShellAdmin();
  if (t) api('logout', t);
  toast('Anda telah keluar.', 'info');
  navigateTo('login', { tanpaRiwayat: true });
}

// ============================== CANGKANG ADMIN ==============================
var ADM_MENU = [
  { g: 'Utama', i: [['dashboard', 'bi-speedometer2', 'Dashboard']] },
  { g: 'Konten Website', i: [['halaman', 'bi-file-text', 'Halaman Profil'], ['pejabat', 'bi-person-badge', 'Pejabat'], ['pegawai', 'bi-people', 'Pegawai'],
    ['bagan', 'bi-diagram-3', 'Bagan Organisasi'], ['layanan', 'bi-cash-coin', 'Layanan & Tarif'], ['syaratalur', 'bi-list-check', 'Syarat & Alur'],
    ['dokumen', 'bi-file-earmark-text', 'Dokumen'], ['galeri', 'bi-images', 'Galeri'], ['berita', 'bi-newspaper', 'Berita & Pengumuman'], ['statistik', 'bi-bar-chart', 'Statistik Grafik']] },
  { g: 'Interaksi', i: [['pesan', 'bi-inbox', 'Pesan Masuk'], ['pelanggan', 'bi-envelope-paper', 'Pelanggan']] },
  { g: 'Sistem', i: [['petugas', 'bi-shield-lock', 'Akun Petugas'], ['pengaturan', 'bi-gear', 'Pengaturan Website'], ['log', 'bi-clock-history', 'Log Aktivitas']] }
];
var ADM_HALAMAN = {};

function masukModeAdmin() {
  document.body.classList.add('admin-mode'); document.body.classList.remove('login-mode');
  var r = $('#admin-root'); r.hidden = false;
  if (!r.dataset.built) { bangunShellAdmin(); r.dataset.built = '1'; }
}
function keluarModeAdmin() {
  document.body.classList.remove('admin-mode');
  var r = $('#admin-root'); if (r) r.hidden = true;
}
function resetShellAdmin() {
  var r = $('#admin-root'); if (r) { r.innerHTML = ''; delete r.dataset.built; }
  AppState.adm = { page: 'dashboard', rows: [], modul: null };
}
function bangunShellAdmin() {
  var c = (AppState.data && AppState.data.config) || {};
  var menu = ADM_MENU.map(function (g) {
    return '<div class="adm-group">' + esc(g.g) + '</div>' + g.i.map(function (m) {
      return '<a href="javascript:void(0)" class="adm-link" data-adm="' + m[0] + '" onclick="admNav(\'' + m[0] + '\')"><i class="bi ' + m[1] + '" aria-hidden="true"></i><span>' + esc(m[2]) + '</span>' +
        (m[0] === 'pesan' ? '<span class="pill" id="pill-pesan" hidden></span>' : '') + '</a>';
    }).join('');
  }).join('');
  $('#admin-root').innerHTML = '<div class="adm-shell"><aside class="adm-side" id="adm-side" aria-label="Menu pengelolaan">' +
    '<div class="adm-brand"><span class="brand-logo brand-logo-sm">' + logoHtml(c) + '</span><div><small>Panel Petugas</small><strong>' + esc(c.nama_uptd || 'UPTD PKB') + '</strong></div></div>' +
    '<nav class="adm-nav">' + menu + '</nav>' +
    '<div class="adm-side-foot"><a href="javascript:void(0)" class="adm-link" onclick="navigateTo(\'beranda\')"><i class="bi bi-box-arrow-up-right" aria-hidden="true"></i><span>Lihat website</span></a>' +
    '<a href="javascript:void(0)" class="adm-link" onclick="admLogout()"><i class="bi bi-box-arrow-left" aria-hidden="true"></i><span>Keluar</span></a></div></aside>' +
    '<div class="adm-back" id="adm-back" hidden onclick="tutupSideAdm()"></div>' +
    '<div class="adm-main"><header class="adm-top"><div class="flex center-y gap-1"><button type="button" class="icon-btn adm-menu-btn" onclick="bukaSideAdm()" aria-label="Buka menu"><i class="bi bi-list" aria-hidden="true"></i></button>' +
    '<h1 id="adm-judul">Dashboard</h1></div><div class="adm-user"><span class="adm-nama" style="display:none"></span>' +
    '<button type="button" class="icon-btn theme-toggle" onclick="toggleTheme()" aria-label="Ganti mode tampilan"><i class="bi bi-moon-stars" aria-hidden="true"></i></button>' +
    '<button type="button" class="btn btn-outline btn-sm" onclick="bukaGantiSandi()"><i class="bi bi-key" aria-hidden="true"></i> <span class="hide-sm">Kata sandi</span></button></div></header>' +
    '<div class="adm-content" id="adm-content" tabindex="-1"></div></div></div>';
  var n = $('.adm-nama'); if (n && AppState.user) { n.innerHTML = 'Halo, <strong>' + esc(AppState.user.nama) + '</strong>'; n.style.display = ''; }
  terapkanTema(document.documentElement.getAttribute('data-theme'));
}
function bukaSideAdm() { $('#adm-side').classList.add('open'); $('#adm-back').hidden = false; }
function tutupSideAdm() { var s = $('#adm-side'); if (s) s.classList.remove('open'); var b = $('#adm-back'); if (b) b.hidden = true; }

function admNav(id) {
  if (!AppState.token) { navigateTo('login'); return; }
  masukModeAdmin();
  AppState.adm.page = id;
  tutupSideAdm();
  $$('.adm-link[data-adm]').forEach(function (a) { a.classList.toggle('active', a.dataset.adm === id); });
  var label = id;
  ADM_MENU.forEach(function (g) { g.i.forEach(function (m) { if (m[0] === id) label = m[2]; }); });
  $('#adm-judul').textContent = label;
  window.scrollTo(0, 0);
  var el = $('#adm-content');
  hancurkanChart();
  var fn = ADM_HALAMAN[id] || (MODUL[id] ? function (e) { admModul(id, e); } : null);
  if (!fn) { el.innerHTML = kosong('bi-question-circle', 'Halaman tidak ditemukan.'); return; }
  admLoading(el);
  fn(el);
}
function admLoading(el) { el.innerHTML = '<div class="page-loading" role="status"><div class="spinner-blue" aria-hidden="true"></div><span>Memuat data&hellip;</span></div>'; }
function admError(el, pesan, ulang) {
  el.innerHTML = '<div class="empty"><i class="bi bi-exclamation-triangle" aria-hidden="true"></i><p><strong>Data belum dapat dimuat.</strong><br>' + esc(pesan) + '</p>' +
    '<button type="button" class="btn btn-navy" onclick="admNav(\'' + esc(ulang || AppState.adm.page) + '\')">Coba lagi</button></div>';
}
function tandaiBerubah() { AppState.dirty = true; }
function setPill(n) {
  var p = $('#pill-pesan'); if (!p) return;
  p.hidden = !n; p.textContent = n > 99 ? '99+' : n;
}

// ============================== DASHBOARD ==============================
ADM_HALAMAN.dashboard = function (el) {
  apiA('adminDashboard').then(function (r) {
    if (AppState.adm.page !== 'dashboard') return;
    if (!r.success) { if (r.code !== 'SESI') admError(el, r.message); return; }
    var d = r.data;
    setPill(d.pesanBaru);
    el.innerHTML = '<div class="stat-grid">' +
      [['bi-inbox', d.pesanBaru, 'Pesan baru', 'pesan'], ['bi-newspaper', d.beritaTerbit, 'Berita terbit', 'berita'], ['bi-pencil-square', d.beritaDraft, 'Draft berita', 'berita'], ['bi-envelope-paper', d.pelangganAktif, 'Pelanggan aktif', 'pelanggan']]
        .map(function (s) { return '<a href="javascript:void(0)" class="stat-tile" style="text-decoration:none" onclick="admNav(\'' + s[3] + '\')"><i class="bi ' + s[0] + '" aria-hidden="true" style="color:var(--gold-dark)"></i><div class="n">' + fmtAngka(s[1]) + '</div><div class="l">' + s[2] + '</div></a>'; }).join('') +
      '</div><div class="grid cols-2"><div class="adm-card"><h2>Pesan terbaru</h2>' +
      (d.pesanTerbaru.length ? '<ul class="log-list">' + d.pesanTerbaru.map(function (p) {
        return '<li><time>' + fmtWaktu(p.Waktu) + '</time><span><strong>' + esc(p.Nama) + '</strong> ' + badgeStatusPesan(p.Status) + ' <span class="text-muted">(' + esc(p.Jenis_Pesan) + ')</span></span></li>';
      }).join('') + '</ul><button type="button" class="btn btn-outline btn-sm mt-2" onclick="admNav(\'pesan\')">Buka semua pesan</button>' : '<p class="text-muted mb-0">Belum ada pesan masuk.</p>') + '</div>' +
      '<div class="adm-card"><h2>Aktivitas terakhir</h2>' + (d.aktivitas.length ? '<ul class="log-list">' + d.aktivitas.map(function (a) {
        return '<li><time>' + fmtWaktu(a.Waktu) + '</time><span><strong>' + esc(a.Username) + '</strong>: ' + esc(a.Aksi) + ' (' + esc(a.Modul) + ')</span></li>';
      }).join('') + '</ul>' : '<p class="text-muted mb-0">Belum ada aktivitas.</p>') + '</div></div>' +
      '<div class="alert alert-info"><i class="bi bi-envelope-check" aria-hidden="true"></i><span>Sisa kuota pengiriman email hari ini: <strong>' + fmtAngka(d.kuotaEmail) + '</strong>. Pengumuman ke pelanggan dikirim sesuai sisa kuota.</span></div>';
  });
};
function badgeStatusPesan(s) {
  var k = { Baru: 'b-success', Diproses: 'b-warning', Selesai: 'b-info' }[s] || 'b-info';
  return '<span class="badge ' + k + '">' + esc(s) + '</span>';
}

// ============================== UNGGAH BERKAS ==============================
var MB = 1024 * 1024;
var BATAS = { foto: { mb: 2, dim: 1000 }, bagan: { mb: 4, dim: 2400 }, berita: { mb: 3, dim: 1600 }, galeri: { mb: 4, dim: 1800 }, logo: { mb: 1, dim: 512 }, dokumen: { mb: 8 } };

function bacaDataUrl(f) {
  return new Promise(function (res, rej) {
    var r = new FileReader();
    r.onload = function () { res(String(r.result)); };
    r.onerror = function () { rej(new Error('Berkas tidak dapat dibaca.')); };
    r.readAsDataURL(f);
  });
}
function tanpaAwalan(u) { return u.replace(/^data:[^;]*;base64,/, ''); }

/** Menyiapkan berkas: validasi jenis/ukuran dan (untuk gambar) mengecilkan sebelum diunggah. */
function siapkanBerkas(file, kind) {
  var b = BATAS[kind];
  if (kind === 'dokumen') {
    if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) return Promise.reject(new Error('Hanya berkas PDF yang diizinkan.'));
    if (file.size > b.mb * MB) return Promise.reject(new Error('Ukuran PDF melebihi ' + b.mb + ' MB.'));
    return bacaDataUrl(file).then(tanpaAwalan);
  }
  if (!/^image\/(jpeg|png)$/.test(file.type)) return Promise.reject(new Error('Gunakan gambar berformat JPG atau PNG.'));
  return bacaDataUrl(file).then(function (url) {
    return new Promise(function (res, rej) {
      var img = new Image();
      img.onerror = function () { rej(new Error('Gambar rusak atau tidak dapat dibaca.')); };
      img.onload = function () {
        var s = Math.min(1, b.dim / Math.max(img.width, img.height));
        if (s >= 1 && file.size <= b.mb * MB * 0.95) { res(tanpaAwalan(url)); return; }   // sudah cukup kecil
        var cv = document.createElement('canvas');
        cv.width = Math.max(1, Math.round(img.width * s)); cv.height = Math.max(1, Math.round(img.height * s));
        var ctx = cv.getContext('2d');
        var keluar = null;
        if (file.type === 'image/png' && (kind === 'logo' || kind === 'bagan')) {      // pertahankan transparansi bila muat
          ctx.drawImage(img, 0, 0, cv.width, cv.height);
          var p = cv.toDataURL('image/png');
          if (p.length * 0.75 <= b.mb * MB * 0.95) keluar = p;
        }
        if (!keluar) {
          ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, cv.width, cv.height);
          ctx.drawImage(img, 0, 0, cv.width, cv.height);
          var q = 0.9;
          for (var i = 0; i < 6; i++) {
            keluar = cv.toDataURL('image/jpeg', q);
            if (keluar.length * 0.75 <= b.mb * MB * 0.95) break;
            q -= 0.12;
          }
        }
        if (keluar.length * 0.75 > b.mb * MB) { rej(new Error('Ukuran gambar masih melebihi ' + b.mb + ' MB. Gunakan gambar yang lebih kecil.')); return; }
        res(tanpaAwalan(keluar));
      };
      img.src = url;
    });
  });
}

/** Mengunggah berkas ke server. Mengembalikan Promise<{success,data:{id},message}>. */
function unggah(file, kind) {
  return siapkanBerkas(file, kind).then(function (b64) {
    return apiA('uploadFile', kind, b64, file.name, file.type);
  }).catch(function (e) { return { success: false, message: e.message }; });
}

/** Widget unggah: HTML + pemasangan event. */
function uploadHtml(k, kind, nilai, acc) {
  var pdf = kind === 'dokumen';
  return '<div class="upload-box" data-up="' + k + '" data-kind="' + kind + '"><div class="upload-prev">' +
    (nilai ? (pdf ? '<i class="bi bi-file-earmark-pdf" aria-hidden="true"></i>' : imgTag(nilai, 200, '')) : '<i class="bi ' + (pdf ? 'bi-file-earmark-pdf' : 'bi-image') + '" aria-hidden="true"></i>') + '</div>' +
    '<div class="upload-info"><div data-info>' + (nilai ? 'Berkas tersimpan.' : 'Belum ada berkas.') + '</div>' +
    '<div class="hint">' + (pdf ? 'PDF, maks. ' : 'JPG/PNG, maks. ') + BATAS[kind].mb + ' MB' + (pdf ? '' : '. Gambar besar dikecilkan otomatis.') + '</div>' +
    '<div class="flex gap-1 wrap mt-1"><label class="btn btn-outline btn-sm"><i class="bi bi-upload" aria-hidden="true"></i> Pilih berkas<input type="file" hidden accept="' + acc + '"></label>' +
    '<button type="button" class="btn btn-ghost btn-sm" data-hapus-file' + (nilai ? '' : ' hidden') + '>Lepas berkas</button></div></div>' +
    '<input type="hidden" name="' + k + '" value="' + esc(nilai || '') + '"></div>';
}
function pasangUpload(root, onSelesai) {
  $$('.upload-box', root).forEach(function (box) {
    var kind = box.dataset.kind, pdf = kind === 'dokumen';
    var input = $('input[type=file]', box), hid = $('input[type=hidden]', box), info = $('[data-info]', box), prev = $('.upload-prev', box), hapus = $('[data-hapus-file]', box);
    input.addEventListener('change', function () {
      var f = input.files && input.files[0]; if (!f) return;
      info.innerHTML = '<span class="spinner" aria-hidden="true"></span> Mengunggah&hellip;';
      box.dataset.sibuk = '1';
      unggah(f, kind).then(function (r) {
        delete box.dataset.sibuk; input.value = '';
        if (!r.success) { info.textContent = 'Gagal mengunggah.'; if (r.code !== 'SESI') toast(r.message, 'error'); return; }
        hid.value = r.data.id; tandaiBerubah();
        prev.innerHTML = pdf ? '<i class="bi bi-file-earmark-pdf" aria-hidden="true"></i>' : imgTag(r.data.id, 200, '');
        info.textContent = 'Berhasil diunggah: ' + f.name;
        if (hapus) hapus.hidden = false;
        toast(r.message || 'Berkas berhasil diunggah.', 'success');
        if (onSelesai) onSelesai(box.dataset.up, r.data.id);
      });
    });
    if (hapus) hapus.addEventListener('click', function () {
      hid.value = ''; prev.innerHTML = '<i class="bi ' + (pdf ? 'bi-file-earmark-pdf' : 'bi-image') + '" aria-hidden="true"></i>';
      info.textContent = 'Berkas dilepas (klik Simpan untuk menerapkan).'; hapus.hidden = true;
    });
  });
}
function adaUploadBerjalan(root) { return !!$('.upload-box[data-sibuk]', root); }

// ============================== MODUL CRUD GENERIK ==============================
var MODUL = {
  pejabat: {
    sheet: 'Pejabat', judul: 'Pejabat', urut: true, cari: ['Nama', 'Jabatan'],
    kolom: [['Foto_ID', 'Foto', 'foto'], ['Nama', 'Nama'], ['Jabatan', 'Jabatan'], ['Urutan', 'Urutan', 'num'], ['Aktif', 'Status', 'aktif']],
    form: [{ k: 'Nama', l: 'Nama lengkap', t: 'text', req: 1, max: 120 }, { k: 'Jabatan', l: 'Jabatan', t: 'text', req: 1, max: 150 },
      { k: 'Foto_ID', l: 'Foto', t: 'file', kind: 'foto', acc: 'image/jpeg,image/png' }, { k: 'Aktif', l: 'Tampilkan di website', t: 'yn' }]
  },
  pegawai: {
    sheet: 'Pegawai', judul: 'Pegawai', urut: true, cari: ['Nama', 'Jabatan_Bagian'],
    kolom: [['Foto_ID', 'Foto', 'foto'], ['Nama', 'Nama'], ['Jabatan_Bagian', 'Jabatan / Bagian'], ['Urutan', 'Urutan', 'num'], ['Aktif', 'Status', 'aktif']],
    form: [{ k: 'Nama', l: 'Nama lengkap', t: 'text', req: 1, max: 120 }, { k: 'Jabatan_Bagian', l: 'Jabatan / bagian', t: 'text', req: 1, max: 150 },
      { k: 'Foto_ID', l: 'Foto', t: 'file', kind: 'foto', acc: 'image/jpeg,image/png' }, { k: 'Aktif', l: 'Tampilkan di website', t: 'yn' }]
  },
  layanan: {
    sheet: 'Layanan_Tarif', judul: 'Layanan', urut: true, cari: ['Layanan', 'Jenis_Kendaraan', 'Tarif'],
    kolom: [['Layanan', 'Layanan'], ['Jenis_Kendaraan', 'Jenis kendaraan'], ['Tarif', 'Tarif'], ['Urutan', 'Urutan', 'num'], ['Aktif', 'Status', 'aktif']],
    form: [{ k: 'Layanan', l: 'Nama layanan', t: 'text', req: 1, max: 150 }, { k: 'Jenis_Kendaraan', l: 'Jenis kendaraan', t: 'text', max: 120 },
      { k: 'Tarif', l: 'Tarif', t: 'text', max: 80, hint: 'Tulis apa adanya, misalnya: Rp 50.000 atau Gratis.' },
      { k: 'Dasar_Hukum', l: 'Dasar hukum', t: 'text', max: 200 }, { k: 'Keterangan', l: 'Keterangan', t: 'textarea', rows: 3, max: 800 },
      { k: 'Aktif', l: 'Tampilkan di website', t: 'yn' }]
  },
  syaratalur: {
    sheet: 'Syarat_Alur', judul: 'Syarat / Alur', urut: true, tab: 'Jenis', tabNilai: ['Syarat', 'Alur'], cari: ['Judul', 'Deskripsi'],
    kolom: [['Jenis', 'Jenis', 'jenis'], ['Urutan', 'Urutan', 'num'], ['Judul', 'Judul'], ['Deskripsi', 'Deskripsi', 'ringkas']],
    form: [{ k: 'Jenis', l: 'Jenis', t: 'select', opsi: ['Syarat', 'Alur'], req: 1 }, { k: 'Judul', l: 'Judul', t: 'text', req: 1, max: 150 },
      { k: 'Deskripsi', l: 'Deskripsi', t: 'textarea', rows: 4, max: 1200 }]
  },
  dokumen: {
    sheet: 'Dokumen', judul: 'Dokumen', cari: ['Judul', 'Nomor_Tahun'],
    kolom: [['Judul', 'Judul'], ['Kategori', 'Kategori', 'jenis'], ['Nomor_Tahun', 'Nomor / Tahun'], ['Tanggal', 'Tanggal', 'tgl'], ['Aktif', 'Status', 'aktif']],
    form: [{ k: 'Judul', l: 'Judul dokumen', t: 'text', req: 1, max: 200 }, { k: 'Kategori', l: 'Kategori', t: 'select', opsi: ['Regulasi', 'Pelayanan', 'Formulir'], req: 1 },
      { k: 'Nomor_Tahun', l: 'Nomor / tahun', t: 'text', max: 100, hint: 'Contoh: Peraturan Wali Kota Nomor 10 Tahun 2020' },
      { k: 'File_ID', l: 'Berkas PDF', t: 'file', kind: 'dokumen', acc: 'application/pdf', req: 1 },
      { k: 'Tanggal', l: 'Tanggal', t: 'date' }, { k: 'Aktif', l: 'Tampilkan di website', t: 'yn' }]
  },
  galeri: {
    sheet: 'Galeri', judul: 'Foto', cari: ['Judul', 'Album'],
    kolom: [['File_ID', 'Foto', 'foto'], ['Judul', 'Judul'], ['Album', 'Album'], ['Tanggal', 'Tanggal', 'tgl']],
    form: [{ k: 'Judul', l: 'Judul foto', t: 'text', req: 1, max: 150 }, { k: 'Album', l: 'Album', t: 'text', max: 80, hint: 'Foto dengan nama album yang sama dikelompokkan bersama.' },
      { k: 'Keterangan', l: 'Keterangan', t: 'textarea', rows: 2, max: 500 }, { k: 'File_ID', l: 'Foto', t: 'file', kind: 'galeri', acc: 'image/jpeg,image/png', req: 1 },
      { k: 'Tanggal', l: 'Tanggal', t: 'date' }]
  },
  berita: {
    sheet: 'Berita', judul: 'Berita', lebar: 'lg', cari: ['Judul', 'Ringkasan'], berita: true,
    kolom: [['Judul', 'Judul'], ['Jenis', 'Jenis', 'jenis'], ['Status', 'Status', 'status'], ['Tanggal_Terbit', 'Tanggal terbit', 'tgl'], ['Email_Terkirim', 'Email', 'email']],
    form: [{ k: 'Judul', l: 'Judul', t: 'text', req: 1, max: 200 },
      { k: 'Jenis', l: 'Jenis', t: 'select', opsi: ['Berita', 'Pengumuman'], req: 1 }, { k: 'Status', l: 'Status', t: 'select', opsi: ['Draft', 'Terbit'] },
      { k: 'Tanggal_Terbit', l: 'Tanggal terbit', t: 'date', hint: 'Kosongkan untuk memakai tanggal hari ini saat diterbitkan.' },
      { k: 'Foto_ID', l: 'Foto sampul', t: 'file', kind: 'berita', acc: 'image/jpeg,image/png' },
      { k: 'Ringkasan', l: 'Ringkasan (opsional)', t: 'textarea', rows: 2, max: 300, hint: 'Bila kosong, diambil otomatis dari awal isi.' },
      { k: 'Isi', l: 'Isi', t: 'textarea', rows: 12, req: 1, max: 30000, hint: FORMAT_HINT_TEKS() }]
  }
};
function FORMAT_HINT_TEKS() {
  return 'Pisahkan paragraf dengan baris kosong. Judul bagian: awali dengan "## ". Daftar: awali baris dengan "- " atau "1. ". Tebal: **teks**. Tautan: [teks](https://alamat).';
}

function jenisBadge(v) {
  var k = { Syarat: 'b-info', Alur: 'b-gold', Berita: 'b-info', Pengumuman: 'b-gold', Regulasi: 'b-info', Pelayanan: 'b-gold', Formulir: 'b-success' }[v] || 'b-info';
  return '<span class="badge ' + k + '">' + esc(v) + '</span>';
}
function selData(r, kol) {
  var v = r[kol[0]], t = kol[2];
  switch (t) {
    case 'foto': return '<div class="thumb">' + (v ? imgTag(v, 120, '') : '<i class="bi bi-image" aria-hidden="true"></i>') + '</div>';
    case 'aktif': return v === 'Ya' ? '<span class="badge b-success">Aktif</span>' : '<span class="badge b-warning">Nonaktif</span>';
    case 'status': return v === 'Terbit' ? '<span class="badge b-success">Terbit</span>' : '<span class="badge b-info">Draft</span>';
    case 'jenis': return jenisBadge(v);
    case 'tgl': return v ? fmtTanggal(v) : '-';
    case 'ringkas': return esc(potongTeks(v, 90)) || '-';
    case 'num': return esc(v);
    case 'email':
      if (r.Jenis !== 'Pengumuman') return '<span class="text-muted">-</span>';
      return v === 'Ya' ? '<span class="badge b-success">Terkirim</span>' : v === 'Sebagian' ? '<span class="badge b-warning">Sebagian</span>' : '<span class="text-muted">Belum</span>';
    default: return esc(v) || '-';
  }
}

function admModul(key, el) {
  var m = MODUL[key];
  AppState.adm.modul = key; AppState.adm.q = ''; AppState.adm.tabAktif = m.tab ? m.tabNilai[0] : null; AppState.adm.fStatus = '';
  apiA('adminList', m.sheet).then(function (r) {
    if (AppState.adm.page !== key) return;
    if (!r.success) { if (r.code !== 'SESI') admError(el, r.message, key); return; }
    AppState.adm.rows = r.data;
    el.innerHTML = '<div class="adm-card"><div class="toolbar"><div class="search-box"><i class="bi bi-search" aria-hidden="true"></i><label class="sr-only" for="adm-q">Cari</label>' +
      '<input id="adm-q" class="input" type="search" placeholder="Cari ' + esc(m.judul.toLowerCase()) + '" maxlength="80" oninput="AppState.adm.q=this.value.toLowerCase().trim();admIsiTabel()"></div>' +
      (m.tab ? '<div class="chip-row" id="adm-tab">' + m.tabNilai.map(function (t, i) { return '<button type="button" class="chip' + (i === 0 ? ' active' : '') + '" data-tab="' + t + '">' + t + '</button>'; }).join('') + '</div>' : '') +
      (m.berita ? '<label class="sr-only" for="adm-fs">Filter status</label><select id="adm-fs" class="select" onchange="AppState.adm.fStatus=this.value;admIsiTabel()"><option value="">Semua status</option><option>Terbit</option><option>Draft</option></select>' : '') +
      '<button type="button" class="btn btn-gold" onclick="admTambah()"><i class="bi bi-plus-lg" aria-hidden="true"></i> Tambah</button></div><div id="adm-tabel"></div></div>';
    $$('#adm-tab .chip').forEach(function (b) {
      b.addEventListener('click', function () {
        AppState.adm.tabAktif = b.dataset.tab;
        $$('#adm-tab .chip').forEach(function (x) { x.classList.toggle('active', x === b); });
        admIsiTabel();
      });
    });
    admIsiTabel();
  });
}
function admTersaring() {
  var m = MODUL[AppState.adm.modul], a = AppState.adm;
  return a.rows.filter(function (r) {
    if (m.tab && r[m.tab] !== a.tabAktif) return false;
    if (a.fStatus && r.Status !== a.fStatus) return false;
    if (a.q && !m.cari.some(function (k) { return String(r[k] || '').toLowerCase().indexOf(a.q) >= 0; })) return false;
    return true;
  });
}
function admIsiTabel() {
  var m = MODUL[AppState.adm.modul], a = AppState.adm, el = $('#adm-tabel'); if (!el) return;
  var h = admTersaring(); a.tampil = h;
  if (!h.length) { el.innerHTML = kosong('bi-inbox', a.rows.length ? 'Tidak ada data yang cocok.' : 'Belum ada data. Klik "Tambah" untuk mulai.'); return; }
  var bolehUrut = m.urut && !a.q && !a.fStatus;
  el.innerHTML = '<div class="table-wrap"><table class="tbl tbl-resp adm-table"><thead><tr>' + m.kolom.map(function (k) { return '<th>' + esc(k[1]) + '</th>'; }).join('') + '<th class="num">Aksi</th></tr></thead><tbody>' +
    h.map(function (r, i) {
      var aksi = '';
      if (bolehUrut) {
        aksi += '<button type="button" class="btn btn-outline" onclick="admGeser(' + i + ',-1)" aria-label="Naikkan urutan"' + (i === 0 ? ' disabled' : '') + '><i class="bi bi-arrow-up" aria-hidden="true"></i></button>' +
          '<button type="button" class="btn btn-outline" onclick="admGeser(' + i + ',1)" aria-label="Turunkan urutan"' + (i === h.length - 1 ? ' disabled' : '') + '><i class="bi bi-arrow-down" aria-hidden="true"></i></button>';
      }
      if (m.berita) {
        aksi += '<button type="button" class="btn btn-outline" onclick="admToggleTerbit(' + i + ',this)">' + (r.Status === 'Terbit' ? 'Tarik' : 'Terbitkan') + '</button>';
        if (r.Jenis === 'Pengumuman' && r.Status === 'Terbit' && r.Email_Terkirim !== 'Ya') aksi += '<button type="button" class="btn btn-outline" onclick="admKirimEmail(' + i + ',this)"><i class="bi bi-envelope" aria-hidden="true"></i> Kirim</button>';
      }
      aksi += '<button type="button" class="btn btn-outline" onclick="admEdit(' + i + ')"><i class="bi bi-pencil" aria-hidden="true"></i> Ubah</button>' +
        '<button type="button" class="btn btn-outline" style="color:var(--bad)" onclick="admHapus(' + i + ')" aria-label="Hapus"><i class="bi bi-trash" aria-hidden="true"></i></button>';
      return '<tr>' + m.kolom.map(function (k) { return '<td data-label="' + esc(k[1]) + '">' + selData(r, k) + '</td>'; }).join('') + '<td class="aksi"><div class="row-actions">' + aksi + '</div></td></tr>';
    }).join('') + '</tbody></table></div><p class="hint mt-1">' + h.length + ' data' + (bolehUrut ? '. Gunakan tombol panah untuk mengatur urutan tampil.' : '.') + '</p>';
}

function admGeser(i, arah) {
  var m = MODUL[AppState.adm.modul], h = AppState.adm.tampil, j = i + arah;
  if (j < 0 || j >= h.length) return;
  var ids = h.map(function (r) { return r.ID; });
  var t = ids[i]; ids[i] = ids[j]; ids[j] = t;
  // Perbarui tampilan lebih dulu, lalu simpan ke server
  var baris = h[i]; h[i] = h[j]; h[j] = baris;
  h.forEach(function (r, n) { r.Urutan = n + 1; });
  AppState.adm.rows.sort(function (a, b) { return a.Urutan - b.Urutan; });
  admIsiTabel();
  apiA('adminUrutkan', m.sheet, ids).then(function (r) {
    if (r.success) tandaiBerubah();
    else { toast(r.message, 'error'); admNav(AppState.adm.modul); }
  });
}
function admTambah() { bukaFormModul(null); }
function admEdit(i) { bukaFormModul(AppState.adm.tampil[i]); }
function admHapus(i) {
  var m = MODUL[AppState.adm.modul], r = AppState.adm.tampil[i];
  var nama = r.Judul || r.Nama || r.Layanan || 'data ini';
  konfirmasi({ judul: 'Hapus data', pesan: 'Hapus "' + nama + '"? Tindakan ini tidak dapat dibatalkan.', tombol: 'Ya, hapus', bahaya: true }).then(function (ya) {
    if (!ya) return;
    apiA('adminDelete', m.sheet, r.ID).then(function (res) {
      if (res.success) { toast(res.message, 'success'); tandaiBerubah(); admNav(AppState.adm.modul); }
      else toast(res.message, 'error');
    });
  });
}
function admToggleTerbit(i, btn) {
  var r = AppState.adm.tampil[i], baru = r.Status === 'Terbit' ? 'Draft' : 'Terbit';
  sibuk(btn, true, '...');
  apiA('adminSave', 'Berita', { ID: r.ID, Status: baru }).then(function (res) {
    sibuk(btn, false);
    if (res.success) { toast(baru === 'Terbit' ? 'Berita diterbitkan.' : 'Berita ditarik menjadi draft.', 'success'); tandaiBerubah(); admNav('berita'); }
    else toast(res.message, 'error');
  });
}
function admKirimEmail(i, btn) {
  var r = AppState.adm.tampil[i];
  konfirmasi({ judul: 'Kirim ke pelanggan', pesan: 'Kirim pengumuman "' + r.Judul + '" ke seluruh pelanggan aktif? Setiap alamat hanya menerima satu kali.', tombol: 'Ya, kirim' }).then(function (ya) {
    if (!ya) return;
    sibuk(btn, true, 'Mengirim...');
    apiA('kirimBroadcast', r.ID).then(function (res) {
      sibuk(btn, false);
      toast(res.message, res.success ? 'success' : 'error', 8000);
      if (res.success) admNav('berita');
    });
  });
}

/** Formulir tambah/ubah, dibangun dari konfigurasi MODUL[..].form. */
function bukaFormModul(rec) {
  var key = AppState.adm.modul, m = MODUL[key], baru = !rec;
  var v = function (k, def) { return rec && rec[k] !== undefined && rec[k] !== '' ? rec[k] : (def === undefined ? '' : def); };
  var html = '<form id="form-modul" novalidate onsubmit="return false">' + m.form.map(function (f) {
    var id = 'f-' + f.k, isi = '';
    var label = '<label class="label" for="' + id + '">' + esc(f.l) + (f.req ? ' <span class="req">*</span>' : '') + '</label>';
    switch (f.t) {
      case 'text': isi = label + '<input class="input" id="' + id + '" name="' + f.k + '" maxlength="' + (f.max || 200) + '" value="' + esc(v(f.k)) + '">'; break;
      case 'textarea': isi = label + '<textarea class="textarea" id="' + id + '" name="' + f.k + '" rows="' + (f.rows || 4) + '" maxlength="' + (f.max || 2000) + '">' + esc(v(f.k)) + '</textarea>'; break;
      case 'date': isi = label + '<input class="input" type="date" id="' + id + '" name="' + f.k + '" value="' + esc(String(v(f.k)).substring(0, 10)) + '">'; break;
      case 'select': {
        var cur = v(f.k, f.k === 'Status' ? 'Draft' : (m.tab && f.k === m.tab ? AppState.adm.tabAktif : f.opsi[0]));
        isi = label + '<select class="select" id="' + id + '" name="' + f.k + '">' + f.opsi.map(function (o) { return '<option' + (o === cur ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('') + '</select>';
        break;
      }
      case 'yn': isi = '<label class="check"><input type="checkbox" name="' + f.k + '"' + (baru || rec[f.k] === 'Ya' ? ' checked' : '') + '> ' + esc(f.l) + '</label>'; break;
      case 'file': isi = '<span class="label">' + esc(f.l) + (f.req ? ' <span class="req">*</span>' : '') + '</span>' + uploadHtml(f.k, f.kind, v(f.k), f.acc); break;
    }
    return '<div class="field">' + isi + (f.hint ? '<div class="hint">' + esc(f.hint) + '</div>' : '') + '<div class="field-err" data-err="' + f.k + '"></div></div>';
  }).join('') +
    (m.berita ? '<div class="field" id="blok-kirim" hidden><label class="check"><input type="checkbox" id="f-kirim"> Kirim email ke pelanggan setelah disimpan</label>' +
      '<div class="hint">Email hanya terkirim satu kali per pengumuman.</div></div>' : '') + '</form>';
  var mdl = bukaModal({
    judul: (baru ? 'Tambah ' : 'Ubah ') + m.judul, lebar: m.lebar || '', isi: html,
    footer: '<button type="button" class="btn btn-outline" onclick="tutupModalTeratas()">Batal</button><button type="button" class="btn btn-navy" data-simpan>Simpan</button>'
  });
  pasangUpload(mdl.body);
  if (m.berita) {
    var toggle = function () {
      var f = $('#form-modul'), sudah = rec && rec.Email_Terkirim === 'Ya';
      $('#blok-kirim').hidden = !(f.Jenis.value === 'Pengumuman' && f.Status.value === 'Terbit' && !sudah);
    };
    $('#form-modul').Jenis.addEventListener('change', toggle); $('#form-modul').Status.addEventListener('change', toggle); toggle();
  }
  $('[data-simpan]', mdl.foot).addEventListener('click', function () { simpanFormModul(mdl, rec); });
}
function simpanFormModul(mdl, rec) {
  var m = MODUL[AppState.adm.modul], f = $('#form-modul'), data = {}, err = {};
  if (adaUploadBerjalan(mdl.body)) { toast('Tunggu hingga unggahan selesai.', 'warning'); return; }
  m.form.forEach(function (fld) {
    var el = f.elements[fld.k], val;
    if (fld.t === 'yn') val = el.checked ? 'Ya' : 'Tidak';
    else val = String(el.value || '').trim();
    if (fld.req && !val) err[fld.k] = 'Wajib diisi.';
    data[fld.k] = val;
  });
  $$('[data-err]', f).forEach(function (e) { e.textContent = err[e.dataset.err] || ''; });
  $$('.input, .select, .textarea', f).forEach(function (e) { e.classList.toggle('err', !!err[e.name]); });
  var p = Object.keys(err)[0];
  if (p) { toast('Lengkapi isian yang ditandai.', 'warning'); var t = f.elements[p]; if (t && t.focus) t.focus(); return; }
  if (rec) data.ID = rec.ID;
  var kirim = m.berita && $('#f-kirim') && $('#f-kirim').checked && !$('#blok-kirim').hidden;
  var btn = $('[data-simpan]', mdl.foot);
  sibuk(btn, true, 'Menyimpan...');
  apiA('adminSave', m.sheet, data).then(function (r) {
    sibuk(btn, false);
    if (!r.success) { if (r.code !== 'SESI') toast(r.message, 'error'); return; }
    toast(r.message, 'success'); tandaiBerubah(); mdl.tutup();
    var id = r.data && r.data.ID;
    if (kirim && id) {
      toast('Mengirim email ke pelanggan…', 'info');
      apiA('kirimBroadcast', id).then(function (b) { toast(b.message, b.success ? 'success' : 'error', 8000); admNav('berita'); });
    } else admNav(AppState.adm.modul);
  });
}

// ============================== HALAMAN PROFIL ==============================
ADM_HALAMAN.halaman = function (el) {
  apiA('adminHalamanGet').then(function (r) {
    if (AppState.adm.page !== 'halaman') return;
    if (!r.success) { if (r.code !== 'SESI') admError(el, r.message); return; }
    AppState.adm.hal = r.data; AppState.adm.hKey = AppState.adm.hKey || 'sejarah';
    renderHalamanAdm(el);
  });
};
function renderHalamanAdm(el) {
  var key = AppState.adm.hKey, h = AppState.adm.hal[key] || { judul: '', isi: '' };
  var tabs = PROFIL_HAL, bawaan = '';
  PROFIL_HAL.forEach(function (t) { if (t[0] === key) bawaan = t[1]; });
  if (!h.judul) h = { judul: bawaan, isi: h.isi || '', oleh: h.oleh, pada: h.pada };
  el.innerHTML = '<div class="adm-card"><div class="tab-row chip-row">' + tabs.map(function (t) {
    return '<button type="button" class="chip' + (t[0] === key ? ' active' : '') + '" onclick="AppState.adm.hKey=\'' + t[0] + '\';renderHalamanAdm($(\'#adm-content\'))">' + t[1] + '</button>';
  }).join('') + '</div>' +
    '<div class="field"><label class="label" for="h-judul">Judul halaman</label><input id="h-judul" class="input" maxlength="120" value="' + esc(h.judul) + '"></div>' +
    '<div class="field"><label class="label" for="h-isi">Isi halaman</label><textarea id="h-isi" class="textarea" rows="18" maxlength="30000">' + esc(h.isi) + '</textarea><div class="hint">' + esc(FORMAT_HINT_TEKS()) + '</div></div>' +
    (h.pada ? '<p class="hint">Terakhir diubah oleh <strong>' + esc(h.oleh) + '</strong> pada ' + fmtWaktu(h.pada) + '.</p>' : '') +
    '<button type="button" class="btn btn-navy" id="btn-hal" onclick="simpanHalamanAdm()"><i class="bi bi-check2" aria-hidden="true"></i> Simpan halaman</button></div>';
}
function simpanHalamanAdm() {
  var key = AppState.adm.hKey, judul = $('#h-judul').value.trim(), isi = $('#h-isi').value;
  if (!judul) { toast('Judul wajib diisi.', 'warning'); return; }
  var btn = $('#btn-hal'); sibuk(btn, true, 'Menyimpan...');
  apiA('adminHalamanSimpan', key, judul, isi).then(function (r) {
    sibuk(btn, false);
    if (!r.success) { if (r.code !== 'SESI') toast(r.message, 'error'); return; }
    toast(r.message, 'success'); tandaiBerubah();
    AppState.adm.hal[key] = { judul: judul, isi: isi, oleh: AppState.user.username, pada: new Date().toISOString().replace('T', ' ').substring(0, 19) };
    renderHalamanAdm($('#adm-content'));
  });
}

// ============================== BAGAN ORGANISASI ==============================
ADM_HALAMAN.bagan = function (el) {
  apiA('adminConfigGet').then(function (r) {
    if (AppState.adm.page !== 'bagan') return;
    if (!r.success) { if (r.code !== 'SESI') admError(el, r.message); return; }
    var id = r.data.bagan_file_id;
    el.innerHTML = '<div class="adm-card"><h2>Gambar bagan organisasi</h2><p class="text-muted">Unggah gambar bagan (JPG/PNG). Gambar yang tampil di website dapat diperbesar oleh pengunjung.</p>' +
      '<div id="bagan-form">' + uploadHtml('bagan_file_id', 'bagan', id, 'image/jpeg,image/png') + '</div>' +
      (id ? '<div class="article-img mt-2">' + imgTag(id, 1200, 'Bagan organisasi saat ini') + '</div>' : '') + '</div>';
    pasangUpload($('#bagan-form'), function (k, fid) {
      apiA('adminConfigSimpan', { bagan_file_id: fid }).then(function (s) {
        if (s.success) { toast('Bagan organisasi diperbarui.', 'success'); tandaiBerubah(); admNav('bagan'); } else toast(s.message, 'error');
      });
    });
    var hp = $('[data-hapus-file]', $('#bagan-form'));
    if (hp) hp.addEventListener('click', function () {
      apiA('adminConfigSimpan', { bagan_file_id: '' }).then(function (s) { if (s.success) { tandaiBerubah(); toast('Bagan dilepas.', 'success'); admNav('bagan'); } });
    });
  });
};

// ============================== STATISTIK ==============================
ADM_HALAMAN.statistik = function (el) {
  apiA('adminStatGet').then(function (r) {
    if (AppState.adm.page !== 'statistik') return;
    if (!r.success) { if (r.code !== 'SESI') admError(el, r.message); return; }
    AppState.adm.stat = r.data;
    renderStatistikAdm(el, AppState.adm.tahunEdit);
  });
};
function tahunStatAdm() {
  var s = AppState.adm.stat, o = {};
  Object.keys(s.uji).forEach(function (y) { o[y] = 1; }); Object.keys(s.wajib).forEach(function (y) { o[y] = 1; });
  return Object.keys(o).sort().reverse();
}
function renderStatistikAdm(el, tahun) {
  var s = AppState.adm.stat, yrs = tahunStatAdm();
  tahun = tahun || yrs[0] || String(new Date().getFullYear());
  AppState.adm.tahunEdit = String(tahun);
  var arr = s.uji[tahun] || [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  el.innerHTML = '<div class="adm-card"><h2>Input data statistik</h2>' +
    '<div class="form-2"><div class="field"><label class="label" for="st-tahun">Tahun</label><input id="st-tahun" class="input" type="number" min="2000" max="2100" value="' + esc(tahun) + '" list="dl-thn" onchange="renderStatistikAdm($(\'#adm-content\'),this.value)">' +
    '<datalist id="dl-thn">' + yrs.map(function (y) { return '<option value="' + y + '">'; }).join('') + '</datalist><div class="hint">Ketik tahun baru, atau pilih tahun yang sudah ada untuk mengubahnya.</div></div>' +
    '<div class="field"><label class="label" for="st-wajib">Jumlah kendaraan wajib uji (setahun)</label><input id="st-wajib" class="input" type="number" min="0" step="1" value="' + (s.wajib[tahun] !== undefined ? esc(s.wajib[tahun]) : '') + '"><div class="hint">Kosongkan bila belum ada data.</div></div></div>' +
    '<span class="label">Jumlah kendaraan diuji per bulan</span><div class="month-grid">' + BULAN.map(function (b, i) {
      return '<div class="field"><label class="label" for="st-b' + i + '">' + b + '</label><input id="st-b' + i + '" class="input" type="number" min="0" step="1" value="' + arr[i] + '"></div>';
    }).join('') + '</div><button type="button" class="btn btn-navy mt-2" id="btn-stat" onclick="simpanStatistikAdm()"><i class="bi bi-check2" aria-hidden="true"></i> Simpan data tahun ini</button></div>' +
    '<div class="adm-card"><h2>Ringkasan per tahun</h2>' + (yrs.length ? '<div class="table-wrap"><table class="tbl tbl-resp adm-table"><thead><tr><th>Tahun</th><th class="num">Total diuji</th><th class="num">Wajib uji</th><th class="num">Aksi</th></tr></thead><tbody>' +
      yrs.map(function (y) {
        var tot = (s.uji[y] || []).reduce(function (a, b) { return a + b; }, 0);
        return '<tr><td data-label="Tahun">' + y + '</td><td data-label="Total diuji" class="num">' + fmtAngka(tot) + '</td><td data-label="Wajib uji" class="num">' + (s.wajib[y] !== undefined ? fmtAngka(s.wajib[y]) : '-') + '</td>' +
          '<td class="aksi"><div class="row-actions"><button type="button" class="btn btn-outline" onclick="renderStatistikAdm($(\'#adm-content\'),\'' + y + '\');window.scrollTo(0,0)">Ubah</button>' +
          '<button type="button" class="btn btn-outline" style="color:var(--bad)" onclick="hapusStatistikAdm(\'' + y + '\')" aria-label="Hapus tahun ' + y + '"><i class="bi bi-trash" aria-hidden="true"></i></button></div></td></tr>';
      }).join('') + '</tbody></table></div>' : '<p class="text-muted mb-0">Belum ada data statistik.</p>') + '</div>';
}
function simpanStatistikAdm() {
  var tahun = $('#st-tahun').value, wajib = $('#st-wajib').value, bulan = [];
  if (!/^\d{4}$/.test(tahun)) { toast('Isi tahun dengan 4 digit (2000-2100).', 'warning'); return; }
  for (var i = 0; i < 12; i++) {
    var n = $('#st-b' + i).value;
    if (n !== '' && (isNaN(Number(n)) || Number(n) < 0 || Math.floor(Number(n)) !== Number(n))) { toast('Jumlah bulan ' + BULAN[i] + ' harus bilangan bulat tidak negatif.', 'warning'); $('#st-b' + i).focus(); return; }
    bulan.push(n === '' ? 0 : Number(n));
  }
  var btn = $('#btn-stat'); sibuk(btn, true, 'Menyimpan...');
  apiA('adminStatSimpan', tahun, bulan, wajib).then(function (r) {
    sibuk(btn, false);
    if (!r.success) { if (r.code !== 'SESI') toast(r.message, 'error'); return; }
    toast(r.message, 'success'); tandaiBerubah();
    AppState.adm.stat = r.data; renderStatistikAdm($('#adm-content'), tahun);
  });
}
function hapusStatistikAdm(y) {
  konfirmasi({ judul: 'Hapus data tahun ' + y, pesan: 'Hapus seluruh data statistik tahun ' + y + '?', tombol: 'Ya, hapus', bahaya: true }).then(function (ya) {
    if (!ya) return;
    apiA('adminStatHapus', y).then(function (r) {
      if (!r.success) { if (r.code !== 'SESI') toast(r.message, 'error'); return; }
      toast(r.message, 'success'); tandaiBerubah();
      AppState.adm.stat = r.data; AppState.adm.tahunEdit = null; renderStatistikAdm($('#adm-content'));
    });
  });
}

// ============================== PESAN MASUK ==============================
ADM_HALAMAN.pesan = function (el) {
  AppState.adm.fPesan = ''; AppState.adm.qPesan = '';
  apiA('adminList', 'Pesan').then(function (r) {
    if (AppState.adm.page !== 'pesan') return;
    if (!r.success) { if (r.code !== 'SESI') admError(el, r.message); return; }
    AppState.adm.pesan = r.data;
    setPill(r.data.filter(function (p) { return p.Status === 'Baru'; }).length);
    el.innerHTML = '<div class="adm-card"><div class="toolbar"><div class="search-box"><i class="bi bi-search" aria-hidden="true"></i><label class="sr-only" for="pq">Cari pesan</label>' +
      '<input id="pq" class="input" type="search" placeholder="Cari nama, email, atau isi pesan" maxlength="80" oninput="AppState.adm.qPesan=this.value.toLowerCase().trim();isiPesanAdm()"></div>' +
      '<label class="sr-only" for="pf">Filter status</label><select id="pf" class="select" onchange="AppState.adm.fPesan=this.value;isiPesanAdm()"><option value="">Semua status</option><option>Baru</option><option>Diproses</option><option>Selesai</option></select></div><div id="tabel-pesan"></div></div>';
    isiPesanAdm();
  });
};
function isiPesanAdm() {
  var a = AppState.adm, el = $('#tabel-pesan'); if (!el) return;
  var h = a.pesan.filter(function (p) {
    return (!a.fPesan || p.Status === a.fPesan) && (!a.qPesan || (p.Nama + ' ' + p.Email + ' ' + p.Isi_Pesan + ' ' + p.ID).toLowerCase().indexOf(a.qPesan) >= 0);
  });
  a.pesanTampil = h;
  if (!h.length) { el.innerHTML = kosong('bi-inbox', a.pesan.length ? 'Tidak ada pesan yang cocok.' : 'Belum ada pesan masuk.'); return; }
  el.innerHTML = '<div class="table-wrap"><table class="tbl tbl-resp adm-table"><thead><tr><th>Waktu</th><th>Jenis</th><th>Nama</th><th>Kendaraan</th><th>Status</th><th class="num">Aksi</th></tr></thead><tbody>' +
    h.map(function (p, i) {
      return '<tr><td data-label="Waktu">' + fmtWaktu(p.Waktu) + '</td><td data-label="Jenis">' + (p.Jenis_Pesan === 'Pengaduan' ? '<span class="badge b-danger">Pengaduan</span>' : '<span class="badge b-info">Kontak</span>') + '</td>' +
        '<td data-label="Nama"><strong>' + esc(p.Nama) + '</strong></td><td data-label="Kendaraan">' + esc(p.Jenis_Kendaraan) + '</td><td data-label="Status">' + badgeStatusPesan(p.Status) + '</td>' +
        '<td class="aksi"><div class="row-actions"><button type="button" class="btn btn-outline" onclick="bukaPesanAdm(' + i + ')"><i class="bi bi-eye" aria-hidden="true"></i> Buka</button></div></td></tr>';
    }).join('') + '</tbody></table></div><p class="hint mt-1">' + h.length + ' pesan.</p>';
}
function bukaPesanAdm(i) {
  var p = AppState.adm.pesanTampil[i];
  var hp = String(p.No_HP).replace(/[^\d+]/g, '');
  var m = bukaModal({
    judul: 'Pesan ' + 'PKB-' + String(p.ID).substring(0, 8).toUpperCase(), lebar: 'lg',
    isi: '<dl class="kv"><dt>Waktu</dt><dd>' + fmtWaktu(p.Waktu) + '</dd><dt>Jenis</dt><dd>' + esc(p.Jenis_Pesan) + '</dd><dt>Nama</dt><dd>' + esc(p.Nama) + '</dd>' +
      '<dt>No. HP</dt><dd>' + esc(p.No_HP) + ' <a href="tel:' + esc(hp) + '" target="_blank" rel="noopener noreferrer">Telepon</a></dd>' +
      '<dt>Email</dt><dd>' + esc(p.Email) + ' <a href="mailto:' + esc(p.Email) + '" target="_blank" rel="noopener noreferrer">Kirim email</a></dd><dt>Kendaraan</dt><dd>' + esc(p.Jenis_Kendaraan) + '</dd></dl>' +
      '<span class="label">Isi pesan</span><div class="msg-box">' + esc(p.Isi_Pesan) + '</div>' +
      '<div class="form-2"><div class="field"><label class="label" for="pm-status">Status</label><select id="pm-status" class="select">' +
      ['Baru', 'Diproses', 'Selesai'].map(function (s) { return '<option' + (s === p.Status ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select></div></div>' +
      '<div class="field"><label class="label" for="pm-cat">Catatan petugas</label><textarea id="pm-cat" class="textarea" rows="3" maxlength="1000">' + esc(p.Catatan_Petugas) + '</textarea></div>',
    footer: '<button type="button" class="btn btn-outline" onclick="tutupModalTeratas()">Tutup</button><button type="button" class="btn btn-navy" data-simpan>Simpan</button>'
  });
  $('[data-simpan]', m.foot).addEventListener('click', function () {
    var btn = $('[data-simpan]', m.foot); sibuk(btn, true, 'Menyimpan...');
    apiA('adminSave', 'Pesan', { ID: p.ID, Status: $('#pm-status').value, Catatan_Petugas: $('#pm-cat').value }).then(function (r) {
      sibuk(btn, false);
      if (!r.success) { if (r.code !== 'SESI') toast(r.message, 'error'); return; }
      toast(r.message, 'success'); m.tutup(); admNav('pesan');
    });
  });
}

// ============================== PELANGGAN ==============================
ADM_HALAMAN.pelanggan = function (el) {
  apiA('adminList', 'Pelanggan').then(function (r) {
    if (AppState.adm.page !== 'pelanggan') return;
    if (!r.success) { if (r.code !== 'SESI') admError(el, r.message); return; }
    var aktif = r.data.filter(function (p) { return p.Status === 'Aktif'; }).length;
    el.innerHTML = '<div class="adm-card"><div class="toolbar between"><div><strong>' + fmtAngka(aktif) + '</strong> pelanggan aktif dari ' + fmtAngka(r.data.length) + ' terdaftar.</div>' +
      '<button type="button" class="btn btn-outline" id="btn-csv" onclick="ekspor()"><i class="bi bi-filetype-csv" aria-hidden="true"></i> Ekspor CSV</button></div>' +
      (r.data.length ? '<div class="table-wrap"><table class="tbl tbl-resp adm-table"><thead><tr><th>Email</th><th>Tanggal daftar</th><th>Status</th></tr></thead><tbody>' +
        r.data.map(function (p) {
          return '<tr><td data-label="Email">' + esc(p.Email) + '</td><td data-label="Tanggal daftar">' + fmtWaktu(p.Tanggal_Daftar) + '</td><td data-label="Status">' +
            (p.Status === 'Aktif' ? '<span class="badge b-success">Aktif</span>' : '<span class="badge b-warning">Berhenti</span>') + '</td></tr>';
        }).join('') + '</tbody></table></div>' : kosong('bi-envelope-paper', 'Belum ada pelanggan.')) + '</div>';
  });
};
function ekspor() {
  var btn = $('#btn-csv'); sibuk(btn, true, 'Menyiapkan...');
  apiA('adminPelangganCsv').then(function (r) {
    sibuk(btn, false);
    if (!r.success) { if (r.code !== 'SESI') toast(r.message, 'error'); return; }
    var m = bukaModal({
      judul: 'Ekspor Pelanggan (CSV)', lebar: 'lg',
      isi: '<p class="text-muted">Salin isi di bawah ke berkas .csv, atau gunakan tombol Unduh bila browser mengizinkan.</p><textarea class="textarea" id="csv-teks" rows="12" readonly style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px"></textarea>',
      footer: '<button type="button" class="btn btn-outline" onclick="tutupModalTeratas()">Tutup</button><button type="button" class="btn btn-outline" data-unduh><i class="bi bi-download" aria-hidden="true"></i> Unduh</button><button type="button" class="btn btn-navy" data-salin><i class="bi bi-clipboard" aria-hidden="true"></i> Salin</button>'
    });
    var ta = $('#csv-teks'); ta.value = r.data;
    $('[data-salin]', m.foot).addEventListener('click', function () {
      ta.select();
      var sukses = false;
      try { sukses = document.execCommand('copy'); } catch (e) { sukses = false; }
      if (!sukses && navigator.clipboard) { navigator.clipboard.writeText(ta.value).then(function () { toast('Disalin ke papan klip.', 'success'); }); return; }
      toast(sukses ? 'Disalin ke papan klip.' : 'Salin manual dengan Ctrl+C.', sukses ? 'success' : 'info');
    });
    $('[data-unduh]', m.foot).addEventListener('click', function () {
      try {
        var a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob(['\uFEFF' + r.data], { type: 'text/csv;charset=utf-8' }));
        a.download = 'pelanggan_pkb.csv'; document.body.appendChild(a); a.click(); document.body.removeChild(a);
      } catch (e) { toast('Unduhan diblokir browser. Gunakan tombol Salin.', 'warning'); }
    });
  });
}

// ============================== AKUN PETUGAS ==============================
ADM_HALAMAN.petugas = function (el) {
  apiA('adminPetugasList').then(function (r) {
    if (AppState.adm.page !== 'petugas') return;
    if (!r.success) { if (r.code !== 'SESI') admError(el, r.message); return; }
    AppState.adm.petugas = r.data;
    el.innerHTML = '<div class="adm-card"><div class="toolbar between"><div class="text-muted">Semua petugas memiliki hak akses yang sama.</div>' +
      '<button type="button" class="btn btn-gold" onclick="tambahPetugas()"><i class="bi bi-person-plus" aria-hidden="true"></i> Tambah petugas</button></div>' +
      '<div class="table-wrap"><table class="tbl tbl-resp adm-table"><thead><tr><th>Nama pengguna</th><th>Nama</th><th>Status</th><th>Login terakhir</th><th class="num">Aksi</th></tr></thead><tbody>' +
      r.data.map(function (p, i) {
        var saya = AppState.user && p.Username === AppState.user.username;
        return '<tr><td data-label="Nama pengguna"><strong>' + esc(p.Username) + '</strong>' + (saya ? ' <span class="badge b-gold">Anda</span>' : '') + '</td><td data-label="Nama">' + esc(p.Nama) + '</td>' +
          '<td data-label="Status">' + (p.Aktif === 'Ya' ? '<span class="badge b-success">Aktif</span>' : '<span class="badge b-warning">Nonaktif</span>') + (p.Wajib_Ganti_Password === 'Ya' ? ' <span class="badge b-info">Belum ganti sandi</span>' : '') + '</td>' +
          '<td data-label="Login terakhir">' + (p.Login_Terakhir ? fmtWaktu(p.Login_Terakhir) : '-') + '</td><td class="aksi"><div class="row-actions">' +
          '<button type="button" class="btn btn-outline" onclick="resetPetugas(' + i + ')"><i class="bi bi-key" aria-hidden="true"></i> Reset sandi</button>' +
          (saya ? '' : '<button type="button" class="btn btn-outline" onclick="statusPetugas(' + i + ')">' + (p.Aktif === 'Ya' ? 'Nonaktifkan' : 'Aktifkan') + '</button>') + '</div></td></tr>';
      }).join('') + '</tbody></table></div></div>';
  });
};
function tampilSandiSementara(judul, username, pw) {
  bukaModal({
    judul: judul, lebar: 'sm', statis: true,
    isi: '<p>Akun: <strong>' + esc(username) + '</strong></p><p class="mb-2">Kata sandi sementara (hanya tampil sekali, catat sekarang):</p><div class="pw-box">' + esc(pw) + '</div>' +
      '<p class="hint mt-1">Petugas wajib menggantinya saat login pertama.</p>',
    footer: '<button type="button" class="btn btn-navy" onclick="tutupModalTeratas()">Saya sudah mencatat</button>'
  });
}
function tambahPetugas() {
  var m = bukaModal({
    judul: 'Tambah Petugas', lebar: 'sm',
    isi: '<div class="field"><label class="label" for="pt-u">Nama pengguna</label><input id="pt-u" class="input" maxlength="30" autocapitalize="none" autocomplete="off"><div class="hint">3-30 karakter: huruf kecil, angka, titik, garis bawah.</div></div>' +
      '<div class="field"><label class="label" for="pt-n">Nama lengkap</label><input id="pt-n" class="input" maxlength="100" autocomplete="off"></div>',
    footer: '<button type="button" class="btn btn-outline" onclick="tutupModalTeratas()">Batal</button><button type="button" class="btn btn-navy" data-simpan>Buat akun</button>'
  });
  $('[data-simpan]', m.foot).addEventListener('click', function () {
    var u = $('#pt-u').value.trim().toLowerCase(), n = $('#pt-n').value.trim();
    if (!/^[a-z0-9._]{3,30}$/.test(u)) { toast('Nama pengguna tidak valid.', 'warning'); return; }
    if (n.length < 3) { toast('Nama lengkap minimal 3 karakter.', 'warning'); return; }
    var btn = $('[data-simpan]', m.foot); sibuk(btn, true, 'Membuat...');
    apiA('adminPetugasTambah', u, n).then(function (r) {
      sibuk(btn, false);
      if (!r.success) { if (r.code !== 'SESI') toast(r.message, 'error'); return; }
      m.tutup(); tampilSandiSementara('Akun petugas dibuat', r.data.username, r.data.passwordSementara); admNav('petugas');
    });
  });
}
function resetPetugas(i) {
  var p = AppState.adm.petugas[i];
  konfirmasi({ judul: 'Reset kata sandi', pesan: 'Buat kata sandi sementara baru untuk "' + p.Username + '"? Sesi aktifnya akan diakhiri.', tombol: 'Ya, reset' }).then(function (ya) {
    if (!ya) return;
    apiA('adminPetugasReset', p.Username).then(function (r) {
      if (!r.success) { if (r.code !== 'SESI') toast(r.message, 'error'); return; }
      tampilSandiSementara('Kata sandi direset', r.data.username, r.data.passwordSementara); admNav('petugas');
    });
  });
}
function statusPetugas(i) {
  var p = AppState.adm.petugas[i], aktif = p.Aktif !== 'Ya';
  konfirmasi({ judul: aktif ? 'Aktifkan akun' : 'Nonaktifkan akun', pesan: (aktif ? 'Aktifkan' : 'Nonaktifkan') + ' akun "' + p.Username + '"?', tombol: 'Ya, lanjutkan', bahaya: !aktif }).then(function (ya) {
    if (!ya) return;
    apiA('adminPetugasStatus', p.Username, aktif).then(function (r) {
      if (r.success) { toast(r.message, 'success'); admNav('petugas'); } else if (r.code !== 'SESI') toast(r.message, 'error');
    });
  });
}

// ============================== PENGATURAN WEBSITE ==============================
var CFG_FORM = [
  ['nama_uptd', 'Nama UPTD', 'text'], ['nama_instansi', 'Nama instansi', 'text'], ['tagline', 'Kalimat singkat di beranda (opsional)', 'text'],
  ['alamat', 'Alamat', 'area'], ['telepon', 'Telepon', 'text'], ['email_kontak', 'Email kontak (tampil di website)', 'email'],
  ['jam_layanan', 'Jam layanan', 'area', 'Baris pertama tampil di bilah atas website. Contoh: Senin - Jumat, 08.00 - 15.00 WITA'],
  ['link_pendaftaran', 'Tautan sistem pendaftaran online', 'url', 'Tombol "Daftar Uji Online" membuka tautan ini di tab baru.'],
  ['peta_lokasi', 'Peta lokasi (Google Maps)', 'area', 'Di Google Maps: Bagikan > Sematkan peta > Salin HTML, lalu tempel di sini (kode iframe atau tautan embed).'],
  ['email_notifikasi_admin', 'Email penerima notifikasi pesan masuk', 'email', 'Pesan baru dari formulir akan diteruskan ke email ini.'],
  ['url_website', 'Alamat website (opsional)', 'url', 'Dipakai pada tautan di email. Kosongkan untuk memakai alamat aplikasi ini.']
];
ADM_HALAMAN.pengaturan = function (el) {
  apiA('adminConfigGet').then(function (r) {
    if (AppState.adm.page !== 'pengaturan') return;
    if (!r.success) { if (r.code !== 'SESI') admError(el, r.message); return; }
    var c = r.data;
    el.innerHTML = '<div class="adm-card"><h2>Informasi umum</h2><form id="form-cfg" novalidate onsubmit="return false">' +
      '<div class="field"><span class="label">Logo</span>' + uploadHtml('logo_file_id', 'logo', c.logo_file_id, 'image/jpeg,image/png') + '<div class="hint">Bila kosong, website memakai lambang bawaan berhuruf "PKB". Unggah logo resmi instansi di sini.</div></div>' +
      CFG_FORM.map(function (f) {
        var id = 'c-' + f[0], v = esc(c[f[0]] || '');
        var input = f[2] === 'area' ? '<textarea class="textarea" id="' + id + '" name="' + f[0] + '" rows="3" maxlength="2000">' + v + '</textarea>'
          : '<input class="input" id="' + id + '" name="' + f[0] + '" maxlength="500" value="' + v + '"' + (f[2] === 'email' ? ' type="email"' : '') + '>';
        return '<div class="field"><label class="label" for="' + id + '">' + esc(f[1]) + '</label>' + input + (f[3] ? '<div class="hint">' + esc(f[3]) + '</div>' : '') + '</div>';
      }).join('') +
      '<button type="button" class="btn btn-navy" id="btn-cfg" onclick="simpanCfgAdm()"><i class="bi bi-check2" aria-hidden="true"></i> Simpan pengaturan</button></form></div>';
    pasangUpload($('#form-cfg'));
  });
};
function simpanCfgAdm() {
  var f = $('#form-cfg'), o = {};
  if (adaUploadBerjalan(f)) { toast('Tunggu hingga unggahan selesai.', 'warning'); return; }
  CFG_FORM.forEach(function (x) { o[x[0]] = f.elements[x[0]].value; });
  o.logo_file_id = f.elements.logo_file_id.value;
  var btn = $('#btn-cfg'); sibuk(btn, true, 'Menyimpan...');
  apiA('adminConfigSimpan', o).then(function (r) {
    sibuk(btn, false);
    if (!r.success) { if (r.code !== 'SESI') toast(r.message, 'error'); return; }
    toast(r.message, 'success'); tandaiBerubah();
    muatData(true).then(function () { resetShellAdmin(); masukModeAdmin(); admNav('pengaturan'); }).catch(function () { /* diabaikan */ });
  });
}

// ============================== LOG AKTIVITAS ==============================
ADM_HALAMAN.log = function (el) {
  apiA('adminList', 'Log_Aktivitas').then(function (r) {
    if (AppState.adm.page !== 'log') return;
    if (!r.success) { if (r.code !== 'SESI') admError(el, r.message); return; }
    el.innerHTML = '<div class="adm-card"><h2>300 aktivitas terakhir</h2>' + (r.data.length ? '<div class="table-wrap"><table class="tbl tbl-resp adm-table"><thead><tr><th>Waktu</th><th>Petugas</th><th>Aksi</th><th>Modul</th></tr></thead><tbody>' +
      r.data.map(function (a) { return '<tr><td data-label="Waktu">' + fmtWaktu(a.Waktu) + '</td><td data-label="Petugas">' + esc(a.Username) + '</td><td data-label="Aksi">' + esc(a.Aksi) + '</td><td data-label="Modul">' + esc(a.Modul) + '</td></tr>'; }).join('') +
      '</tbody></table></div>' : kosong('bi-clock-history', 'Belum ada aktivitas tercatat.')) + '</div>';
  });
};


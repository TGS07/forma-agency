#!/usr/bin/env node
/*
  FORMA — builds the Portuguese and English pages from the templates.

    node scripts/build.mjs

  src/*.html          templates: no copy, only {{t:key}} slots
  i18n/pt.json        Portuguese copy (default language, pages at the site root)
  i18n/en.json        English copy (pages in /en/)

  Slots
    {{t:key}}             copy (may contain inline HTML such as <em>)
    {{js:key}}            a JSON value for scripts, in the page language
    {{js:key@pt|en}}      the same value, in a fixed language
    {{lang}}              pt | en
    {{seo}}               canonical, hreflang, og:locale, description, language memory
    {{langswitch:nav}}    PT / EN switcher for the header
    {{langswitch:menu}}   PT / EN switcher for the side menu

  Edit the copy in the JSON files and the layout in src/, then run the build.
  Never edit the generated pages (/*.html, /en/*.html) by hand.
*/
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// inline <style> and <script> are minified when esbuild is installed (npm i); without it the pages ship as written
let esbuild = null;
try { if (!process.env.NO_MINIFY) esbuild = await import('esbuild'); } catch { console.warn('esbuild not found: pages are not minified'); }

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE_URL = 'https://formaagency.pt';   // [A CONFIRMAR] production domain, used by hreflang, canonical and og:url

// template -> file name in each language
const PAGES = [
  { src: 'index',    pt: 'index.html',    en: 'index.html' },
  { src: 'crm',      pt: 'crm.html',      en: 'crm.html' },
  { src: 'solucoes', pt: 'solucoes.html', en: 'solutions.html' },
  { src: 'contacto', pt: 'contacto.html', en: 'contact.html' },
  { src: 'ai-chat',  pt: 'ai-chat.html',  en: 'ai-chat.html' },
];
const EN_NAME = Object.fromEntries(PAGES.map(p => [p.pt, p.en]));
EN_NAME['imoflow.html'] = 'crm.html';   // old URL, now a redirect in Portuguese

const COPY = {
  pt: JSON.parse(readFileSync(join(ROOT, 'i18n/pt.json'), 'utf8')),
  en: JSON.parse(readFileSync(join(ROOT, 'i18n/en.json'), 'utf8')),
};
const LOCALE = { pt: 'pt_PT', en: 'en_GB' };
const SWITCH_LABEL = { pt: 'Idioma', en: 'Language' };
const ASSET = /(["'(,\s])((?:media|fonts|imoflow|js)\/[^"'()\s,]+|imoflow-[\w-]+\.(?:webp|webm|mp4|jpg|png))/g;

const escAttr = s => String(s).replace(/&(?![a-z#0-9]+;)/gi, '&amp;').replace(/"/g, '&quot;');
const LS = new RegExp(String.fromCharCode(0x2028), 'g'), PS = new RegExp(String.fromCharCode(0x2029), 'g');
const jsValue = v => JSON.stringify(v).replace(/<\//g, '<\\/').replace(LS, '\\u2028').replace(PS, '\\u2029');

function get(lang, key, page) {
  const v = COPY[lang][key];
  if (v === undefined) throw new Error(`[${lang}] missing "${key}" (${page})`);
  return v;
}

function url(lang, page) { return lang === 'pt' ? page.pt : 'en/' + page.en; }   // from the site root

function langSwitch(lang, page, where) {
  const toPt = lang === 'pt' ? page.pt : '../' + page.pt;
  const toEn = lang === 'pt' ? 'en/' + page.en : page.en;
  const a = (l, href) => `<a href="${href}" hreflang="${l}" lang="${l}" data-set-lang="${l}"${l === lang ? ' aria-current="true"' : ''}>${l.toUpperCase()}</a>`;
  return `<div class="lang-sw lang-sw--${where}" role="group" aria-label="${SWITCH_LABEL[lang]}">${a('pt', toPt)}<span aria-hidden="true">/</span>${a('en', toEn)}</div>`;
}

function seo(lang, page, tpl) {
  const abs = l => `${SITE_URL}/${url(l, page)}`.replace(/\/index\.html$/, '/');
  const other = lang === 'pt' ? 'en' : 'pt';
  const alt = lang === 'pt' ? 'en/' + page.en : '../' + page.pt;
  const out = [
    `<link rel="canonical" href="${abs(lang)}">`,
    `<link rel="alternate" hreflang="pt" href="${abs('pt')}">`,
    `<link rel="alternate" hreflang="en" href="${abs('en')}">`,
    `<link rel="alternate" hreflang="x-default" href="${abs('pt')}">`,
    `<meta property="og:locale" content="${LOCALE[lang]}">`,
    `<meta property="og:locale:alternate" content="${LOCALE[other]}">`,
  ];
  if (!/property="og:url"/.test(tpl)) out.push(`<meta property="og:url" content="${abs(lang)}">`);
  const desc = COPY[lang][`${page.src}.meta.description`];
  if (desc && !/name="description"/.test(tpl)) out.push(`<meta name="description" content="${escAttr(desc)}">`);
  if (!/property="og:title"/.test(tpl)) out.push(`<meta property="og:title" content="${escAttr(get(lang, `${page.src}.meta.title`, page.src))}">`);
  if (desc && !/property="og:description"/.test(tpl)) out.push(`<meta property="og:description" content="${escAttr(desc)}">`);
  if (!/property="og:image"/.test(tpl)) {
    const img = `${SITE_URL}/media/og-${page.src}${lang === 'en' ? '-en' : ''}.jpg`;
    out.push(`<meta property="og:type" content="website">`, `<meta property="og:site_name" content="FORMA.">`,
      `<meta property="og:image" content="${img}">`, `<meta property="og:image:width" content="1200">`, `<meta property="og:image:height" content="630">`,
      `<meta name="twitter:card" content="summary_large_image">`, `<meta name="twitter:image" content="${img}">`);
  }
  // icons, theme colour and app manifest (same on every page)
  const up = lang === 'pt' ? '' : '../';
  out.push(`<link rel="icon" href="${up}favicon.svg" type="image/svg+xml">`, `<link rel="icon" href="${up}favicon-32.png" sizes="32x32" type="image/png">`,
    `<link rel="apple-touch-icon" href="${up}apple-touch-icon.png">`, `<link rel="manifest" href="${up}site.webmanifest">`);
  if (!/name="theme-color"/.test(tpl)) out.push(`<meta name="theme-color" content="#F4F1EB">`);
  // structured data: who FORMA is, on the home page only
  if (page.src === 'index') out.push(`<script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org', '@type': 'ProfessionalService', '@id': `${SITE_URL}/#org`,
    name: 'FORMA.', url: `${SITE_URL}/`, logo: `${SITE_URL}/icon-512.png`, image: `${SITE_URL}/media/og-index.jpg`,
    description: COPY[lang]['index.meta.description'], inLanguage: lang === 'pt' ? 'pt-PT' : 'en-GB',
    areaServed: 'PT', address: { '@type': 'PostalAddress', addressLocality: 'Lisboa', addressCountry: 'PT' },
  })}</script>`);
  out.push(`<style>
  .lang-sw{display:inline-flex;align-items:center;gap:2px;font-family:var(--geist,'Geist',system-ui,sans-serif);font-size:12px;font-weight:500;letter-spacing:.08em;line-height:1;color:inherit}
  .lang-sw a{display:inline-flex;align-items:center;min-height:44px;padding:0 5px;color:inherit;text-decoration:none;opacity:.72;transition:opacity .2s ease}
  .lang-sw a:hover,.lang-sw a[aria-current]{opacity:1}
  .lang-sw a:focus-visible{outline:2px solid currentColor;outline-offset:2px;border-radius:4px}
  .lang-sw span{opacity:.45}
  .lang-sw--menu{color:#F4F1EB;font-size:13px;margin:0 0 18px -5px}
  @media (max-width:767px){.nav-right .lang-sw--nav{display:none}}
</style>`);
  // remember the visitor's choice: a later visit from outside the site opens in that language
  out.push(`<script>(function(){var K='forma-lang',L='${lang}';try{var s=localStorage.getItem(K),r=document.referrer,same=r&&r.indexOf(location.origin)===0;if(s&&s!==L&&!same){location.replace('${alt}'+location.hash);return;}}catch(e){}document.addEventListener('click',function(e){var a=e.target.closest&&e.target.closest('a[data-set-lang]');if(a){try{localStorage.setItem(K,a.getAttribute('data-set-lang'));}catch(_){}}});})();</script>`);
  return out.join('\n');
}

function render(lang, page) {
  const tpl = readFileSync(join(ROOT, 'src', page.src + '.html'), 'utf8');
  let html = tpl
    .replace(/\{\{lang\}\}/g, lang)
    .replace(/\{\{seo\}\}/g, () => seo(lang, page, tpl))
    .replace(/\{\{langswitch:(nav|menu)\}\}/g, (_, w) => langSwitch(lang, page, w))
    .replace(/\{\{js:([\w.-]+)(?:@(pt|en))?\}\}/g, (_, k, l) => jsValue(get(l || lang, k, page.src)))
    .replace(/(=\s*")\{\{t:([\w.-]+)\}\}(")/g, (_, a, k, b) => a + escAttr(get(lang, k, page.src)) + b)
    .replace(/\{\{t:([\w.-]+)\}\}/g, (_, k) => get(lang, k, page.src));
  const left = html.match(/\{\{[^}]*\}\}/);
  if (left) throw new Error(`unfilled slot ${left[0]} in ${page.src}`);
  // share images need absolute URLs
  html = html.replace(/(<meta (?:property="og:image"|name="twitter:image") content=")(?!https?:)([^"]+)"/g, (_, a, p) => `${a}${SITE_URL}/${p}"`);
  if (lang === 'en') {
    html = html
      .replace(/(href=)(["'])(index|crm|solucoes|contacto|ai-chat|imoflow)\.html(#[^"']*)?\2/g, (_, a, q, n, h) => `${a}${q}${EN_NAME[n + '.html']}${h || ''}${q}`)
      .replace(ASSET, '$1../$2');
  }
  return html;
}

function minify(html) {
  if (!esbuild) return html;
  const t = (code, loader) => { try { return esbuild.transformSync(code, { loader, minify: loader === 'css', minifyWhitespace: true, minifySyntax: true, legalComments: 'none' }).code.trim(); } catch (e) { console.warn('minify skipped:', e.message.split('\n')[0]); return code; } };
  return html
    .replace(/(<style[^>]*>)([\s\S]*?)(<\/style>)/g, (_, a, c, b) => a + t(c, 'css') + b)
    .replace(/(<script(?![^>]*\bsrc=)(?![^>]*type="application\/(?:ld\+)?json")[^>]*>)([\s\S]*?)(<\/script>)/g, (_, a, c, b) => c.trim() ? a + t(c, 'js') + b : a + c + b)
    .replace(/<!--(?!\[if)[\s\S]*?-->/g, '');
}

let n = 0;
for (const lang of ['pt', 'en']) {
  for (const page of PAGES) {
    const file = join(ROOT, lang === 'pt' ? '' : 'en', lang === 'pt' ? page.pt : page.en);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, minify(render(lang, page)));
    n++;
  }
}

// sitemap with both languages linked to each other
const loc = (l, p) => `${SITE_URL}/${url(l, p)}`.replace(/\/index\.html$/, '/');
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${PAGES.filter(p => p.src !== 'ai-chat').flatMap(p => ['pt', 'en'].map(l => `  <url>
    <loc>${loc(l, p)}</loc>
    <xhtml:link rel="alternate" hreflang="pt" href="${loc('pt', p)}"/>
    <xhtml:link rel="alternate" hreflang="en" href="${loc('en', p)}"/>
    <xhtml:link rel="alternate" hreflang="x-default" href="${loc('pt', p)}"/>
  </url>`)).join('\n')}
</urlset>
`;
writeFileSync(join(ROOT, 'sitemap.xml'), sitemap);
console.log(`built ${n} pages (pt + en) and sitemap.xml`);

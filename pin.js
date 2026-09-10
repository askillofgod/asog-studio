/* ============================================================
   ASOG 수정 요청 위젯  (pin.js)
   ------------------------------------------------------------
   개발 중인 사이트의 </body> 앞에 아래 한 줄만 넣으면 됩니다.

     <script src="https://asog-studio.pages.dev/pin.js"
             data-key="f-xxxxxxxx"></script>

   고객은 화면을 클릭해 핀을 찍고 하고 싶은 말을 적습니다.
   스튜디오(/studio/)에서 목록·상태·답변을 관리합니다.

   · 라이브러리 의존성 없음 (fetch 로 Supabase RPC 직접 호출)
   · Shadow DOM 을 써서 고객 사이트 CSS 와 섞이지 않습니다
   · 오픈 시에는 이 <script> 한 줄만 지우면 흔적이 남지 않습니다
   ============================================================ */
(function () {
  "use strict";

  if (window.__ASOG_PIN__) return;
  window.__ASOG_PIN__ = true;

  var SUPABASE_URL = "https://qtiazentdzwzkgrsjbob.supabase.co";
  var SUPABASE_KEY = "sb_publishable_bKsdXn04F_MCXT9YgCiYZg_biJjPRZC";

  var me = document.currentScript;
  var KEY = (me && me.getAttribute("data-key")) || "";
  if (!KEY) return;

  var BRAND = "#0040C8";
  var STATUS = {
    "new":   { label: "접수",      color: "#0040C8" },
    "doing": { label: "작업 중",   color: "#B07800" },
    "done":  { label: "완료",      color: "#1B8A5A" },
    "hold":  { label: "협의 필요", color: "#7A8395" }
  };

  var items = [];          // 이 프로젝트의 전체 수정 요청
  var company = "";
  var placing = false;     // 핀 찍기 모드
  var panelOpen = false;
  var editingId = null;
  var author = "";
  try { author = localStorage.getItem("asog_pin_author") || ""; } catch (e) {}

  /* ── 통신 ────────────────────────────────────────────── */
  function rpc(fn, body) {
    return fetch(SUPABASE_URL + "/rest/v1/rpc/" + fn, {
      method: "POST",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: "Bearer " + SUPABASE_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    }).then(function (r) {
      return r.ok ? r.json() : null;
    }).catch(function () { return null; });
  }

  /* ── 위치 저장·복원 ──────────────────────────────────── */
  // 클릭한 요소를 CSS 경로로 적어둡니다. 화면 크기가 달라져도
  // 같은 요소를 다시 찾아 그 안의 상대 위치에 핀을 놓기 위해서입니다.
  function selectorOf(el) {
    if (!el || el.nodeType !== 1) return "";
    if (el === document.body) return "body";
    var parts = [], n = el, guard = 0;
    while (n && n.nodeType === 1 && n !== document.body && guard++ < 12) {
      if (n.id && /^[A-Za-z][\w-]*$/.test(n.id)) { parts.unshift("#" + n.id); return parts.join(">"); }
      var tag = n.tagName.toLowerCase(), par = n.parentNode, idx = 1, same = 0;
      if (par && par.children) {
        for (var i = 0; i < par.children.length; i++) {
          if (par.children[i].tagName === n.tagName) { same++; if (par.children[i] === n) idx = same; }
        }
        if (same > 1) tag += ":nth-of-type(" + idx + ")";
      }
      parts.unshift(tag);
      n = par;
    }
    return "body>" + parts.join(">");
  }

  function findEl(sel) {
    if (!sel) return null;
    try { return document.querySelector(sel); } catch (e) { return null; }
  }

  // 핀이 화면의 어느 지점에 놓여야 하는지 (문서 기준 좌표)
  function pointOf(it) {
    var el = findEl(it.selector);
    if (!el) return null;
    var r = el.getBoundingClientRect();
    if (!r.width && !r.height) return null;
    return {
      x: r.left + window.pageXOffset + r.width * (Number(it.x_pct) || 0),
      y: r.top + window.pageYOffset + r.height * (Number(it.y_pct) || 0)
    };
  }

  function pathNow() { return location.pathname + location.search; }
  function isMobile() { return Math.min(window.innerWidth, window.innerHeight) < 700; }
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function when(t) {
    var d = new Date(t), n = new Date(), diff = (n - d) / 1000;
    if (diff < 60) return "방금";
    if (diff < 3600) return Math.floor(diff / 60) + "분 전";
    if (diff < 86400) return Math.floor(diff / 3600) + "시간 전";
    return (d.getMonth() + 1) + "월 " + d.getDate() + "일";
  }

  /* ── 화면 만들기 ─────────────────────────────────────── */
  var host = document.createElement("div");
  host.id = "asog-pin-root";
  host.style.cssText = "all:initial;position:fixed;inset:0;z-index:2147483000;pointer-events:none";
  var root = host.attachShadow ? host.attachShadow({ mode: "open" }) : host;

  var CSS = [
    ':host{all:initial}',
    '*{box-sizing:border-box;margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,"Malgun Gothic","맑은 고딕",sans-serif}',
    '.layer{position:absolute;inset:0;pointer-events:none}',

    /* 핀 — 고칠 자리를 크게 표시합니다 */
    '.pin{position:absolute;width:38px;height:38px;margin:-19px 0 0 -19px;border-radius:50% 50% 50% 4px;',
    ' transform:rotate(-45deg);display:flex;align-items:center;justify-content:center;',
    ' background:var(--c);color:#fff;font-size:16px;font-weight:800;cursor:pointer;pointer-events:auto;',
    ' box-shadow:0 4px 14px rgba(0,0,0,.34);border:3px solid #fff;transition:transform .14s}',
    '.pin span{transform:rotate(45deg);letter-spacing:-.02em}',
    '.pin::before{content:"";position:absolute;inset:-10px;border-radius:inherit;',
    ' border:2px solid var(--c);opacity:.32;pointer-events:none}',
    '.pin:hover{transform:rotate(-45deg) scale(1.14)}',
    '.pin.sel{animation:asogpulse 1s ease-out 2}',
    '@keyframes asogpulse{0%{transform:rotate(-45deg) scale(1)}',
    ' 45%{transform:rotate(-45deg) scale(1.32)}100%{transform:rotate(-45deg) scale(1)}}',

    /* 그 핀이 가리키는 영역을 네모로 감싸 보여줍니다 */
    '.box{position:absolute;border:2.5px dashed var(--c);border-radius:6px;pointer-events:none;',
    ' background:rgba(0,64,200,.07);opacity:0;transition:opacity .15s}',
    '@supports (background:color-mix(in srgb,#000 9%,transparent)){',
    ' .box{background:color-mix(in srgb, var(--c) 9%, transparent)}}',
    '.box.on{opacity:1}',

    /* 핀을 찍는 동안 마우스가 올라간 영역을 미리 보여줍니다 */
    '.hbox{position:absolute;border:2.5px solid ' + BRAND + ';border-radius:6px;pointer-events:none;',
    ' background:rgba(0,64,200,.10);opacity:0;transition:opacity .1s}',
    '.hbox.on{opacity:1}',
    '.hbox b{position:absolute;left:-2.5px;top:-25px;background:' + BRAND + ';color:#fff;font-size:12px;',
    ' font-weight:700;padding:3px 9px;border-radius:5px 5px 5px 0;white-space:nowrap;line-height:1.4}',
    '.box b{position:absolute;left:-2.5px;top:-25px;background:var(--c);color:#fff;font-size:12px;',
    ' font-weight:700;padding:3px 9px;border-radius:5px 5px 5px 0;white-space:nowrap;line-height:1.4}',

    /* 아래 고정 버튼 */
    '.fab{position:fixed;right:18px;bottom:18px;pointer-events:auto;display:flex;gap:8px;align-items:center}',
    '.btn{border:0;border-radius:999px;padding:11px 18px;font-size:14px;font-weight:600;cursor:pointer;',
    ' box-shadow:0 4px 14px rgba(12,33,65,.22);line-height:1;white-space:nowrap}',
    '.btn.main{background:' + BRAND + ';color:#fff}',
    '.btn.main.on{background:#0C2141}',
    '.btn.ghost{background:#fff;color:#0C2141;border:1px solid #D5DCE8}',
    '.btn:active{transform:translateY(1px)}',
    '.cnt{display:inline-block;margin-left:7px;background:rgba(255,255,255,.24);border-radius:999px;padding:2px 7px;font-size:12px}',

    /* 안내 띠 */
    '.tip{position:fixed;left:50%;top:16px;transform:translateX(-50%);pointer-events:auto;',
    ' background:#0C2141;color:#fff;padding:11px 18px;border-radius:999px;font-size:14px;',
    ' box-shadow:0 6px 20px rgba(12,33,65,.28);display:flex;gap:14px;align-items:center;',
    ' border:1.5px solid rgba(255,255,255,.28)}',
    '.tip b{font-weight:700}',
    '.tip u{cursor:pointer;text-decoration:underline;opacity:.8;font-size:13px}',

    /* 작성 상자 */
    '.pop{position:absolute;width:300px;background:#fff;border-radius:10px;pointer-events:auto;',
    ' box-shadow:0 10px 34px rgba(12,33,65,.26);border:1px solid #E3E8F0;overflow:hidden}',
    '.pop h4{font-size:13px;color:#5A6478;padding:12px 14px 0;font-weight:600}',
    '.pop textarea{width:100%;border:0;padding:10px 14px;font-size:15px;line-height:1.55;resize:vertical;',
    ' min-height:88px;outline:none;color:#0C2141}',
    '.pop input{width:100%;border:0;border-top:1px solid #EEF1F6;padding:9px 14px;font-size:13px;outline:none;color:#0C2141}',
    '.pop .row{display:flex;gap:8px;padding:10px 14px;border-top:1px solid #EEF1F6;background:#F9FAFC}',
    '.pop .row .btn{flex:1;padding:9px 0;font-size:14px;box-shadow:none;text-align:center}',

    /* 목록 패널 */
    '.panel{position:fixed;top:0;right:0;bottom:0;width:380px;max-width:100%;background:#fff;pointer-events:auto;',
    ' box-shadow:-8px 0 30px rgba(12,33,65,.16);display:flex;flex-direction:column;',
    ' transform:translateX(100%);transition:transform .22s ease}',
    '.panel.on{transform:none}',
    '.ph{padding:16px 18px;border-bottom:1px solid #E9EDF4;display:flex;align-items:center;gap:10px}',
    '.ph h3{font-size:15px;color:#0C2141;flex:1;font-weight:700}',
    '.ph .x{border:0;background:none;font-size:22px;line-height:1;color:#7A8395;cursor:pointer;padding:0 2px}',
    '.pb{flex:1;overflow-y:auto;padding:6px 0 18px}',
    '.grp{padding:14px 18px 6px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#8A93A3;font-weight:700}',
    '.it{padding:13px 18px;border-bottom:1px solid #F1F4F9;cursor:pointer}',
    '.it:hover{background:#F7F9FC}',
    '.it .top{display:flex;align-items:center;gap:8px;margin-bottom:5px}',
    '.it .no{font-size:12px;font-weight:700;color:#fff;background:#8A93A3;border-radius:999px;padding:2px 8px;flex:none}',
    '.it .st{font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px;border:1px solid currentColor}',
    '.it .so{font-size:11px;font-weight:700;color:#B07800;background:#FFF6E0;border-radius:999px;padding:2px 8px}',
    '.it .ago{margin-left:auto;font-size:12px;color:#8A93A3;flex:none}',
    '.it p{font-size:14.5px;line-height:1.55;color:#0C2141;white-space:pre-wrap;word-break:break-word}',
    '.it .who{margin-top:5px;font-size:12px;color:#8A93A3}',
    '.it .rep{margin-top:8px;padding:9px 11px;background:#EAF1FF;border-radius:7px;font-size:13.5px;',
    ' line-height:1.55;color:#0C2141;white-space:pre-wrap}',
    '.it .rep b{display:block;font-size:11px;letter-spacing:.06em;color:' + BRAND + ';margin-bottom:3px}',
    '.it .acts{margin-top:10px;display:flex;gap:8px}',
    '.it .acts a{display:inline-flex;align-items:center;justify-content:center;',
    ' padding:8px 16px;border-radius:7px;font-size:13.5px;font-weight:600;line-height:1;',
    ' background:#fff;color:#0C2141;border:1.5px solid #D5DCE8;cursor:pointer;',
    ' text-decoration:none;transition:background .12s,border-color .12s}',
    '.it .acts a:hover{background:#F1F4F9;border-color:#AEBCD2}',
    '.it .acts a:active{transform:translateY(1px)}',
    '.it .acts a[data-act="del"]{color:#C8102E;border-color:#EFD3D8}',
    '.it .acts a[data-act="del"]:hover{background:#FDECEF;border-color:#E0A9B3}',
    '.it .lost{margin-top:6px;font-size:12px;color:#B07800}',
    '.empty{padding:34px 20px;text-align:center;color:#8A93A3;font-size:14px;line-height:1.7}',
    '.pf{padding:12px 18px;border-top:1px solid #E9EDF4;font-size:12px;color:#8A93A3;line-height:1.6}',

    '@media (max-width:560px){',
    ' .fab{right:12px;bottom:12px}',
    ' .btn{padding:10px 15px;font-size:13.5px}',
    ' .pop{width:calc(100vw - 24px);left:12px!important;right:12px}',
    ' .tip{width:calc(100vw - 24px);justify-content:center;font-size:13px;padding:10px 12px}',
    '}'
  ].join("");

  var style = document.createElement("style");
  style.textContent = CSS;
  root.appendChild(style);

  var layer = document.createElement("div"); layer.className = "layer";
  var ui = document.createElement("div");
  root.appendChild(layer);
  root.appendChild(ui);

  /* ── 아래 고정 버튼 ──────────────────────────────────── */
  function renderFab() {
    var here = items.filter(function (i) { return i.path === pathNow(); }).length;
    ui.innerHTML =
      '<div class="fab">' +
        (items.length ? '<button class="btn ghost" id="list">목록 ' + items.length + '</button>' : '') +
        '<button class="btn main' + (placing ? " on" : "") + '" id="add">' +
          (placing ? "그만두기" : "수정 요청") +
          (here && !placing ? '<span class="cnt">이 페이지 ' + here + '</span>' : '') +
        '</button>' +
      '</div>' +
      (placing
        ? '<div class="tip"><b>고치고 싶은 곳을 클릭하세요</b><u id="stop">취소 (Esc)</u></div>'
        : '');

    var add = ui.querySelector("#add");
    if (add) add.onclick = function () { setPlacing(!placing); };
    var lst = ui.querySelector("#list");
    if (lst) lst.onclick = function () { openPanel(true); };
    var stop = ui.querySelector("#stop");
    if (stop) stop.onclick = function () { setPlacing(false); };
  }

  function setPlacing(on) {
    placing = on;
    document.documentElement.style.cursor = on ? "crosshair" : "";
    if (on) { closePanel(); closePop(); hideBox(); }
    else if (hbox) hbox.classList.remove("on");
    renderFab();
  }

  /* ── 핀 그리기 ───────────────────────────────────────── */
  // 핀이 가리키는 영역을 감싸는 네모. 핀에 마우스를 올리거나
  // 목록에서 항목을 누르면 어디를 말하는지 한눈에 보입니다.
  var boxEl = null, boxTimer = null;
  function showBox(it, hold) {
    var el = findEl(it.selector);
    if (!el) return;
    var r = el.getBoundingClientRect();
    if (!r.width && !r.height) return;
    var st = STATUS[it.status] || STATUS["new"];
    if (!boxEl) { boxEl = document.createElement("div"); boxEl.className = "box"; layer.appendChild(boxEl); }
    boxEl.style.setProperty("--c", st.color);
    boxEl.style.left = (r.left - 4) + "px";
    boxEl.style.top = (r.top - 4) + "px";
    boxEl.style.width = (r.width + 8) + "px";
    boxEl.style.height = (r.height + 8) + "px";
    boxEl.innerHTML = '<b' + (r.top < 32 ? ' style="top:4px;border-radius:5px"' : '') +
                      '>#' + it.num + " 여기</b>";
    boxEl.classList.add("on");
    clearTimeout(boxTimer);
    if (hold) boxTimer = setTimeout(hideBox, 2600);
  }
  function hideBox() { if (boxEl) boxEl.classList.remove("on"); }

  function renderPins() {
    layer.innerHTML = "";
    boxEl = null; hbox = null;
    items.forEach(function (it) {
      if (it.path !== pathNow()) return;
      var pt = pointOf(it);
      if (!pt) return;
      var st = STATUS[it.status] || STATUS["new"];
      var el = document.createElement("div");
      el.className = "pin";
      el.style.setProperty("--c", st.color);
      el.style.left = (pt.x - window.pageXOffset) + "px";
      el.style.top = (pt.y - window.pageYOffset) + "px";
      el.title = "#" + it.num + " · " + st.label;
      el.innerHTML = "<span>" + it.num + "</span>";
      el.onmouseenter = function () { showBox(it); };
      el.onmouseleave = hideBox;
      el.onclick = function (e) { e.stopPropagation(); showBox(it, true); openPanel(true, it.id); };
      layer.appendChild(el);
    });
  }

  /* ── 작성 상자 ───────────────────────────────────────── */
  var pop = null;
  function closePop() { if (pop) { pop.remove(); pop = null; } }

  function openPop(draft) {
    closePop();
    pop = document.createElement("div");
    pop.className = "pop";

    var vx = draft.px - window.pageXOffset, vy = draft.py - window.pageYOffset;
    var left = Math.min(Math.max(12, vx + 18), window.innerWidth - 312);
    var top  = Math.min(Math.max(12, vy - 20), window.innerHeight - 260);
    pop.style.left = left + "px";
    pop.style.top = top + "px";

    pop.innerHTML =
      '<h4>' + (editingId ? "수정 요청 고치기" : "무엇을 고칠까요?") + '</h4>' +
      '<textarea id="t" placeholder="예) 이 버튼 색이 너무 흐려서 잘 안 보입니다"></textarea>' +
      '<input id="a" placeholder="작성하신 분 (선택)" value="' + esc(author) + '">' +
      '<div class="row">' +
        '<button class="btn ghost" id="c">취소</button>' +
        '<button class="btn main" id="s">' + (editingId ? "저장" : "보내기") + '</button>' +
      '</div>';
    ui.appendChild(pop);

    var ta = pop.querySelector("#t");
    if (draft.body) ta.value = draft.body;
    setTimeout(function () { ta.focus(); }, 30);

    pop.querySelector("#c").onclick = function () { editingId = null; closePop(); };
    pop.querySelector("#s").onclick = send;
    ta.addEventListener("keydown", function (e) {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") send();
    });

    function send() {
      var body = ta.value.trim();
      if (!body) { ta.focus(); return; }
      author = pop.querySelector("#a").value.trim();
      try { localStorage.setItem("asog_pin_author", author); } catch (e) {}

      var btn = pop.querySelector("#s");
      btn.disabled = true; btn.textContent = "보내는 중…";

      var done = function (row) {
        btn.disabled = false;
        if (!row) { btn.textContent = "다시 시도"; return; }
        editingId = null;
        closePop();
        load();
      };

      if (editingId) {
        rpc("fb_edit", { p_key: KEY, p_id: editingId, p_body: body }).then(done);
      } else {
        rpc("fb_add", {
          p_key: KEY,
          p_item: {
            path: pathNow(), url: location.href,
            selector: draft.selector, x_pct: draft.x_pct, y_pct: draft.y_pct,
            vw: window.innerWidth, device: isMobile() ? "mobile" : "pc",
            ua: navigator.userAgent, body: body, author: author
          }
        }).then(done);
      }
    }
  }

  /* ── 목록 패널 ───────────────────────────────────────── */
  var panel = null;
  function closePanel() {
    panelOpen = false;
    if (panel) { panel.classList.remove("on"); var p = panel; panel = null; setTimeout(function () { p.remove(); }, 240); }
  }

  function openPanel(on, focusId) {
    if (!on) return closePanel();
    closePop();
    if (panel) panel.remove();
    panelOpen = true;

    panel = document.createElement("div");
    panel.className = "panel";

    var here = [], other = [];
    items.forEach(function (i) { (i.path === pathNow() ? here : other).push(i); });

    panel.innerHTML =
      '<div class="ph"><h3>수정 요청' + (company ? " · " + esc(company) : "") + '</h3>' +
      '<button class="x" id="x">&times;</button></div>' +
      '<div class="pb" id="pb"></div>' +
      '<div class="pf">핀을 눌러 그 자리로 이동할 수 있습니다. ' +
      '<b>접수</b> 상태인 요청은 직접 고치거나 지울 수 있습니다.</div>';
    ui.appendChild(panel);
    setTimeout(function () { if (panel) panel.classList.add("on"); }, 10);

    var pb = panel.querySelector("#pb"), html = "";
    if (!items.length) {
      html = '<div class="empty">아직 등록된 수정 요청이 없습니다.<br>' +
             '<b>수정 요청</b>을 누른 뒤 고치고 싶은 곳을 클릭해 보세요.</div>';
    } else {
      if (here.length) html += '<div class="grp">지금 보고 계신 페이지 (' + here.length + ')</div>' + here.map(card).join("");
      if (other.length) html += '<div class="grp">다른 페이지 (' + other.length + ')</div>' + other.map(card).join("");
    }
    pb.innerHTML = html;

    pb.querySelectorAll(".it").forEach(function (el) {
      var id = Number(el.getAttribute("data-id"));
      var it = items.filter(function (i) { return i.id === id; })[0];
      el.onclick = function (e) {
        var act = e.target.getAttribute && e.target.getAttribute("data-act");
        if (act === "edit") {
          e.stopPropagation();
          editingId = id;
          var pt = pointOf(it) || { x: window.pageXOffset + 40, y: window.pageYOffset + 120 };
          closePanel();
          openPop({ px: pt.x, py: pt.y, body: it.body, selector: it.selector, x_pct: it.x_pct, y_pct: it.y_pct });
          return;
        }
        if (act === "del") {
          e.stopPropagation();
          if (!confirm("#" + it.num + " 요청을 지울까요?")) return;
          rpc("fb_remove", { p_key: KEY, p_id: id }).then(function () { load(); });
          return;
        }
        goTo(it);
      };
    });

    panel.querySelector("#x").onclick = function () { closePanel(); };

    if (focusId) {
      var t = pb.querySelector('.it[data-id="' + focusId + '"]');
      if (t) t.scrollIntoView({ block: "center" });
    }
  }

  function card(it) {
    var st = STATUS[it.status] || STATUS["new"];
    var pt = it.path === pathNow() ? pointOf(it) : true;
    return '<div class="it" data-id="' + it.id + '">' +
      '<div class="top">' +
        '<span class="no" style="background:' + st.color + '">#' + it.num + '</span>' +
        '<span class="st" style="color:' + st.color + '">' + st.label + '</span>' +
        (it.scope_out ? '<span class="so">별도 협의</span>' : '') +
        '<span class="ago">' + when(it.created_at) + '</span>' +
      '</div>' +
      '<p>' + esc(it.body) + '</p>' +
      '<div class="who">' + (it.author ? esc(it.author) + " · " : "") + esc(it.path) + '</div>' +
      (it.reply ? '<div class="rep"><b>ASOG 답변</b>' + esc(it.reply) + '</div>' : '') +
      (!pt ? '<div class="lost">화면이 바뀌어 이 자리를 찾지 못했습니다</div>' : '') +
      (it.status === "new"
        ? '<div class="acts"><a data-act="edit">고치기</a><a data-act="del">지우기</a></div>'
        : '') +
    '</div>';
  }

  function goTo(it) {
    if (it.path !== pathNow()) { location.href = it.path; return; }
    var pt = pointOf(it);
    if (!pt) return;
    closePanel();
    window.scrollTo({ top: Math.max(0, pt.y - window.innerHeight / 2), behavior: "smooth" });
    setTimeout(function () {
      showBox(it, true);
      var pins = layer.querySelectorAll(".pin");
      for (var i = 0; i < pins.length; i++) {
        if (pins[i].textContent === String(it.num)) { pins[i].classList.add("sel"); break; }
      }
      setTimeout(function () {
        layer.querySelectorAll(".pin.sel").forEach(function (p) { p.classList.remove("sel"); });
      }, 2400);
    }, 480);
  }

  /* ── 페이지 클릭 잡기 ────────────────────────────────── */
  document.addEventListener("click", function (e) {
    if (!placing) return;
    if (e.target === host || host.contains(e.target)) return;
    e.preventDefault(); e.stopPropagation();

    var el = e.target;
    while (el && el.nodeType !== 1) el = el.parentNode;
    if (!el || el === document.documentElement) el = document.body;

    var r = el.getBoundingClientRect();
    var draft = {
      selector: selectorOf(el),
      x_pct: r.width  ? (e.clientX - r.left) / r.width  : 0.5,
      y_pct: r.height ? (e.clientY - r.top)  / r.height : 0.5,
      px: e.pageX, py: e.pageY
    };
    setPlacing(false);
    openPop(draft);
  }, true);

  // 핀 찍기 모드에서 마우스가 가리키는 영역을 미리 보여줍니다
  var hbox = null;
  function hoverOff() { if (hbox) hbox.classList.remove("on"); }
  document.addEventListener("mousemove", function (e) {
    if (!placing) return hoverOff();
    if (e.target === host || host.contains(e.target)) return hoverOff();
    var el = e.target;
    while (el && el.nodeType !== 1) el = el.parentNode;
    if (!el || el === document.documentElement) return hoverOff();
    var r = el.getBoundingClientRect();
    if (!r.width && !r.height) return hoverOff();
    if (!hbox) { hbox = document.createElement("div"); hbox.className = "hbox"; layer.appendChild(hbox); }
    hbox.style.left = (r.left - 3) + "px";
    hbox.style.top = (r.top - 3) + "px";
    hbox.style.width = (r.width + 6) + "px";
    hbox.style.height = (r.height + 6) + "px";
    hbox.innerHTML = '<b' + (r.top < 32 ? ' style="top:4px;border-radius:5px"' : '') +
                     '>여기를 고칠까요?</b>';
    hbox.classList.add("on");
  }, true);

  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    if (placing) setPlacing(false);
    else if (pop) { editingId = null; closePop(); }
    else if (panelOpen) closePanel();
  });

  var tick = null;
  function reflow() {
    clearTimeout(tick);
    tick = setTimeout(function () { renderPins(); }, 60);
  }
  window.addEventListener("scroll", renderPins, { passive: true });
  window.addEventListener("resize", reflow);
  window.addEventListener("load", reflow);

  /* ── 불러오기 ────────────────────────────────────────── */
  function load() {
    return rpc("fb_list", { p_key: KEY }).then(function (d) {
      if (!d) { items = []; renderFab(); return; }
      company = d.company || "";
      items = d.items || [];
      renderFab();
      renderPins();
      if (panelOpen) openPanel(true);
    });
  }

  function start() {
    document.body.appendChild(host);
    renderFab();
    load();
    setInterval(load, 60000); // 1분마다 상태·답변 갱신
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();

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

  /*
   * 목록 아래에 함께 걸 바로가기.
   *
   * 프로젝트마다 주소가 다르므로 여기 박지 않고 스크립트 줄에서 받는다.
   *   <script src="…/pin.js" data-key="f-…"
   *           data-dash="/dash" data-admin="/admin"></script>
   * 값을 주지 않으면 그 단추는 그리지 않는다.
   */
  var DASH_URL = (me && me.getAttribute("data-dash")) || "";
  var ADMIN_URL = (me && me.getAttribute("data-admin")) || "";

  /*
   * 스튜디오는 이 파일이 놓인 곳에 함께 있다. 주소를 적어 두지 않고 스크립트
   * 자신의 자리에서 셈한다 — 어느 프로젝트에 붙든 자기 스튜디오를 가리킨다.
   */
  var STUDIO_URL = "";
  try { STUDIO_URL = new URL("studio/", me.src).href; } catch (e) {}

  /*
   * 따로 보는 영역.
   *
   *   data-split="/admin"        (쉼표로 여럿도 된다)
   *
   * 한 주소 아래에 성격이 다른 화면이 같이 있을 때 쓴다. 비전필름은 사이트와
   * 관리자 화면이 한 주소를 쓰는데, 둘은 보는 사람도 고치는 사람도 다르다.
   * 한 목록에 섞이면 관리자 화면을 손보는 중에 사이트 요청이 끼어든다.
   *
   * 핀은 원래 그 화면의 것만 그린다. 여기서 가르는 것은 목록과 셈이다.
   */
  var ZONES = ((me && me.getAttribute("data-split")) || "")
    .split(",").map(function (z) { return z.trim(); }).filter(Boolean);

  function zoneOf(p) {
    for (var i = 0; i < ZONES.length; i++) {
      var z = ZONES[i];
      if (p === z || p.indexOf(z + "/") === 0) return z;
    }
    return "";
  }

  /* 형광 보라. 고객 사이트가 쓰지 않는 색이라 "얹힌 도구"로 바로 읽힌다. */
  var BRAND = "#B026FF";
  /* 어소그가 쓴 댓글을 가리는 색. 도구 색(보라)과 섞이지 않게 푸른 계열로 둔다. */
  var ASOG_BLUE = "#1F5FD0";
  var STATUS = {
    "new":   { label: "접수",      color: "#B026FF" },
    "doing": { label: "작업 중",   color: "#B07800" },
    "done":  { label: "완료",      color: "#1B8A5A" },
    "hold":  { label: "협의 필요", color: "#7A8395" }
  };

  var items = [];          // 이 프로젝트의 전체 수정 요청
  var company = "";
  var placing = false;     // 핀 찍기 모드
  var panelOpen = false;
  var editingId = null;
  /*
   * 작성자 이름.
   *
   * 고객이 한 번 적으면 이 브라우저가 기억한다. 어소그 이름("ASOG")은 그
   * 칸에 쓰지 않는다 — 브라우저 공용이라 옆 탭의 고객 화면까지 ASOG로
   * 적히게 된다.
   */
  var author = "";
  try { author = localStorage.getItem("asog_pin_author") || ""; } catch (e) {}

  /*
   * 누구로 글을 남기는가.
   *
   * 역할은 **탭마다** 따로 둔다(`sessionStorage`).
   *
   * 브라우저 전체가 공유하는 저장소에 두었더니, 한 브라우저에서 탭 둘을 열어
   * 고객 화면과 어소그 화면을 같이 보면 둘이 같은 값을 보게 됐다. 한쪽에서
   * 어소그로 들어가면 다른 탭도 어소그가 되어, 고객인 척 남긴 글까지 어소그로
   * 적혔다. 탭마다 두면 한 브라우저로 양쪽을 동시에 볼 수 있다.
   *
   * 확인 번호를 맞혔다는 사실만 브라우저에 남긴다. 그래야 탭을 새로 열 때마다
   * 번호를 다시 묻지 않는다.
   *
   * ASOG는 `?as=asog`가 붙은 주소로 연다. 고객은 평소 링크 그대로다.
   * `?as=client`로 열면 그 탭은 고객으로 돌아온다.
   *
   * 이건 잠금장치가 아니라 문턱이다. 이 파일을 열면 번호가 그대로 보인다.
   * 서버가 보증하는 ASOG 글은 스튜디오에서 쓴 것(admin_fb_say)뿐이다.
   *
   * 주소의 `?as`는 지우지 않는다. 지금 어느 쪽인지 주소창만 봐도 갈리고,
   * 즐겨찾기 해 두면 다음에도 그 모드로 열린다. 대신 핀에 적는 주소에서는 이
   * 조각을 빼낸다(`stripAs`).
   */
  var ASOG_CODE = "0912";

  function roleGet() {
    try { return sessionStorage.getItem("asog_pin_role") || ""; } catch (e) { return ""; }
  }
  function roleSet(v) {
    try {
      if (v) sessionStorage.setItem("asog_pin_role", v);
      else sessionStorage.removeItem("asog_pin_role");
    } catch (e) { /* 저장 못 해도 이번 화면에서는 역할이 선다 */ }
  }
  function codeOk() {
    try { return localStorage.getItem("asog_pin_code_ok") === "1"; } catch (e) { return false; }
  }

  var isAsog = roleGet() === "asog";

  // 번호를 물어야 하는지만 가린다. 묻는 일은 화면이 선 뒤에 한다.
  var needCode = false;
  (function () {
    var q = null;
    try { q = new URLSearchParams(location.search).get("as"); } catch (e) {}
    if (!q) return;
    if (q === "client") {
      isAsog = false;
      roleSet("");
      return;
    }
    if (q !== "asog" || isAsog) return;
    // 이 브라우저에서 번호를 이미 맞혔다면 다시 묻지 않고 이 탭만 어소그로.
    if (codeOk()) { isAsog = true; roleSet("asog"); return; }
    needCode = true;
  })();

  /*
   * 어소그 확인 번호를 묻는 자리.
   *
   * 브라우저의 `prompt`는 쓰지 않는다. 막는 브라우저가 있고, 막히면 그리기가
   * 멈춰 위젯이 통째로 안 뜬다. 우리 그림자 DOM 안에 작은 카드로 묻는다.
   */
  function askCode() {
    if (!needCode) return;
    needCode = false;

    var box = document.createElement("div");
    box.className = "gate";
    box.innerHTML =
      '<div class="gc">' +
        '<h4>어소그로 열기</h4>' +
        '<p>확인 번호 4자리를 넣어 주세요. 고객님이라면 「고객으로 보기」를 눌러 주세요.</p>' +
        '<input id="gi" inputmode="numeric" maxlength="4" placeholder="····" autocomplete="off">' +
        '<div class="ge" id="ge"></div>' +
        '<div class="row"><button class="btn main" id="gok">확인</button>' +
        '<button class="btn ghost" id="gno">고객으로 보기</button></div>' +
      '</div>';
    // `ui`가 아니라 그림자 뿌리에 붙인다. `ui`는 단추를 다시 그릴 때마다
    // 통째로 비워지므로, 거기 두면 자료를 불러오는 순간 카드가 사라진다.
    root.appendChild(box);

    var inp = box.querySelector("#gi");
    var err = box.querySelector("#ge");
    setTimeout(function () { inp.focus(); }, 30);

    function close() { box.remove(); renderFab(); }

    function ok() {
      if ((inp.value || "").trim() !== ASOG_CODE) {
        err.textContent = "번호가 다릅니다.";
        inp.value = "";
        inp.focus();
        return;
      }
      isAsog = true;
      roleSet("asog");
      try { localStorage.setItem("asog_pin_code_ok", "1"); } catch (e) {}
      if (!author) author = "ASOG";
      close();
    }

    box.querySelector("#gok").onclick = ok;
    box.querySelector("#gno").onclick = close;
    inp.onkeydown = function (e) { if (e.key === "Enter") ok(); };
  }

  if (isAsog) author = "ASOG";
  function sayName() { return author || (isAsog ? "ASOG" : "고객"); }

  /*
   * ── 그림 붙이기 ──────────────────────────────────────
   *
   * 화면을 캡처해 "여기가 이렇게 보입니다"를 보여 주는 일이 잦다. 글로만
   * 적으면 서로 다른 곳을 떠올린다.
   *
   * 파일은 스튜디오 저장소(`feedback`)에 올리고, 주소만 글에 적는다.
   * 프로젝트 코드로 폴더를 나눠 다른 고객 것과 섞이지 않게 한다.
   */
  var IMG_MAX = 5;
  var IMG_BYTES = 5 * 1024 * 1024;

  function uploadImage(file) {
    if (!file || file.size > IMG_BYTES) return Promise.resolve(null);
    var ext = (file.type.split("/")[1] || "png").replace("jpeg", "jpg");
    var name = Date.now() + "-" + Math.random().toString(36).slice(2, 8) + "." + ext;
    var path = KEY + "/" + name;
    return fetch(SUPABASE_URL + "/storage/v1/object/feedback/" + path, {
      method: "POST",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: "Bearer " + SUPABASE_KEY,
        "Content-Type": file.type
      },
      body: file
    }).then(function (r) {
      return r.ok ? SUPABASE_URL + "/storage/v1/object/public/feedback/" + path : null;
    }).catch(function () { return null; });
  }

  function uploadAll(files) {
    var list = [].slice.call(files || []).slice(0, IMG_MAX);
    if (!list.length) return Promise.resolve([]);
    return Promise.all(list.map(uploadImage)).then(function (urls) {
      return urls.filter(Boolean);
    });
  }

  /* 목록에 깔리는 작은 그림들 */
  function shots(imgs) {
    var a = Array.isArray(imgs) ? imgs : [];
    if (!a.length) return "";
    return '<div class="shots">' + a.map(function (u) {
      return '<img class="shot" src="' + esc(u) + '" alt="붙임 그림" loading="lazy">';
    }).join("") + '</div>';
  }

  /* 눌러서 크게 보기 */
  function openShot(src) {
    var lb = document.createElement("div");
    lb.className = "lb";
    lb.innerHTML = '<img src="' + esc(src) + '" alt="붙임 그림">' +
                   '<button class="lbx" aria-label="닫기">&times;</button>';
    var close = function () {
      lb.remove();
      document.removeEventListener("keydown", onKey);
    };
    var onKey = function (e) { if (e.key === "Escape") close(); };
    lb.addEventListener("click", close);
    document.addEventListener("keydown", onKey);
    root.appendChild(lb);
  }

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

  // 적어 둔 길이 그대로 맞지 않으면 윗단으로 한 단계씩 줄여 가장 가까운
  // 조상을 찾는다. 탭이 바뀌거나 칸이 하나 늘어난 정도로는 자리를 잃지 않는다.
  function anchorOf(it) {
    var el = findEl(it.selector);
    if (el) return { el: el, exact: true };
    var parts = String(it.selector || "").split(">");
    while (parts.length > 1) {
      parts.pop();
      var up = findEl(parts.join(">"));
      if (up) return { el: up, exact: false };
    }
    return null;
  }

  // 핀이 화면의 어느 지점에 놓여야 하는지 (문서 기준 좌표)
  // 조상으로 물러섰을 때는 그 안의 가운데에 세운다. 원래 비율은 사라진
  // 요소를 기준으로 잰 값이라 엉뚱한 곳을 가리킨다.
  function pointOf(it) {
    var a = anchorOf(it);
    if (!a) return null;
    var r = a.el.getBoundingClientRect();
    if (!r.width && !r.height) return null;
    var fx = a.exact ? (Number(it.x_pct) || 0) : 0.5;
    var fy = a.exact ? (Number(it.y_pct) || 0) : 0.5;
    return {
      x: r.left + window.pageXOffset + r.width * fx,
      y: r.top + window.pageYOffset + r.height * fy,
      exact: a.exact
    };
  }

  // 적을 때는 물음표 뒤까지 그대로 적는다(어느 탭에서 봤는지가 남는다).
  // 다시 그릴 때는 주소만 본다 — `?tab=car`로 적은 핀이 `?tab` 없이 열었다고
  // 통째로 사라지면, 고객은 자기가 적은 것이 지워진 줄 안다.
  // 역할 조각(`?as=`)은 핀의 주소에 넣지 않는다. 어소그가 보든 고객이 보든
  // 같은 화면이고, 같은 자리에 쌓여야 한다.
  function stripAs(search) {
    if (!search) return "";
    try {
      var sp = new URLSearchParams(search);
      sp.delete("as");
      var out = sp.toString();
      return out ? "?" + out : "";
    } catch (e) {
      return search;
    }
  }
  /*
   * 핀과 번호의 색.
   *
   * 「접수」일 때만 누가 남겼는지로 가른다 — 고객은 보라, 어소그는 파랑.
   * 작업 중·완료·협의 필요는 진행을 알리는 색이라 그대로 둔다. 그 단계부터는
   * 누가 적었는지보다 어디까지 됐는지가 궁금하다.
   */
  function hueOf(it) {
    var st = STATUS[it.status] || STATUS["new"];
    if (it.status === "new" && it.by_asog) return ASOG_BLUE;
    return st.color;
  }

  function pathNow() { return location.pathname + stripAs(location.search); }
  function pageNow() { return location.pathname; }
  function pageOf(it) { return String(it.path || "").split("?")[0]; }
  function samePage(it) { return pageOf(it) === pageNow(); }
  /* 지금 보고 있는 영역의 것인가 */
  function sameZone(it) { return zoneOf(pageOf(it)) === zoneOf(pageNow()); }
  function visibleItems() { return ZONES.length ? items.filter(sameZone) : items; }
  function sameView(it) { return it.path === pathNow(); }
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
    /* 조상으로 물러선 핀과, 지금 화면에 자리가 없는 핀 */
    '.pin.near{border-style:dashed}',
    '.pin.lost{border-style:dashed;opacity:.82}',
    '.pin.lost::after{content:"?";position:absolute;right:-5px;bottom:-5px;width:17px;height:17px;',
    ' border-radius:50%;background:#0C2141;color:#fff;font-size:11px;font-weight:800;',
    ' display:flex;align-items:center;justify-content:center;transform:rotate(45deg)}',
    '@keyframes asogpulse{0%{transform:rotate(-45deg) scale(1)}',
    ' 45%{transform:rotate(-45deg) scale(1.32)}100%{transform:rotate(-45deg) scale(1)}}',

    /* 그 핀이 가리키는 영역을 네모로 감싸 보여줍니다 */
    '.box{position:absolute;border:2.5px dashed var(--c);border-radius:6px;pointer-events:none;',
    ' background:rgba(0,64,200,.07);opacity:0;transition:opacity .15s}',
    '@supports (background:color-mix(in srgb,#000 9%,transparent)){',
    ' .box{background:color-mix(in srgb, var(--c) 9%, transparent)}}',
    '.box.on{opacity:1}',

    /* 핀을 찍는 동안 마우스가 올라간 영역을 미리 보여줍니다 */
    '.hbox{position:absolute;border:4px solid ' + BRAND + ';border-radius:6px;pointer-events:none;',
    ' background:rgba(176,38,255,.12);opacity:0;transition:opacity .1s}',
    '.hbox.on{opacity:1}',
    '.hbox b{position:absolute;left:-4px;top:-26px;background:' + BRAND + ';color:#fff;font-size:12px;',
    ' font-weight:700;padding:3px 9px;border-radius:5px 5px 5px 0;white-space:nowrap;line-height:1.4}',
    '.box b{position:absolute;left:-2.5px;top:-25px;background:var(--c);color:#fff;font-size:12px;',
    ' font-weight:700;padding:3px 9px;border-radius:5px 5px 5px 0;white-space:nowrap;line-height:1.4}',

    /* 오른쪽 가운데 모서리에 반만 내민 손잡이.
       위아래는 머리글·전화·맨 위로 같은 단추가 이미 쓰고, 가운데는 거의
       비어 있다. 왼쪽만 둥글려 열리는 쪽을 형태로 가리킨다. */
    '.tab{position:fixed;right:0;top:50%;transform:translateY(-50%);pointer-events:auto;',
    ' display:flex;flex-direction:column;align-items:center;justify-content:center;gap:7px;',
    ' width:56px;padding:26px 0;cursor:pointer;',
    /* 왼쪽만 완전히 둥글려 반달꼴로 둔다. 흰 테두리가 사진 위에서도 윤곽을 지킨다. */
    ' border:2px solid #fff;border-right:0;border-radius:999px 0 0 999px;',
    ' background:' + BRAND + ';color:#fff;',
    ' box-shadow:-8px 0 26px rgba(176,38,255,.42),0 3px 14px rgba(12,33,65,.3);',
    ' transition:width .16s ease,box-shadow .16s ease}',
    '.tab:hover{width:66px;box-shadow:-10px 0 32px rgba(176,38,255,.55),0 3px 14px rgba(12,33,65,.3)}',
    '.tab .ar{font-size:30px;line-height:1;font-weight:700;margin-right:2px}',
    /* 열려 있을 때 — 패널 왼쪽에 붙어 ×로 바뀐다 */
    '.tab.is-open{right:min(380px, 100vw);width:52px;padding:20px 0}',
    '.tab.is-open .ar{font-size:26px;margin-right:0}',
    '.tab .lbl{font-size:12px;font-weight:800;letter-spacing:.02em}',
    '.btn{border:0;border-radius:999px;padding:11px 18px;font-size:14px;font-weight:600;cursor:pointer;',
    ' box-shadow:0 4px 14px rgba(12,33,65,.22);line-height:1;white-space:nowrap}',
    '.btn.main{background:' + BRAND + ';color:#fff}',
    '.btn.main.on{background:#0C2141}',
    '.btn.ghost{background:#fff;color:#0C2141;border:1px solid #D5DCE8}',
    '.btn:active{transform:translateY(1px)}',
    '.cnt{display:inline-block;margin-left:7px;background:rgba(255,255,255,.24);border-radius:999px;padding:2px 7px;font-size:12px}',

    /* 안내 띠 */
    '.tip{position:fixed;left:50%;top:152px;transform:translateX(-50%);pointer-events:auto;',
    ' background:#0C2141;color:#fff;padding:11px 18px;border-radius:999px;font-size:14px;',
    ' box-shadow:0 6px 20px rgba(12,33,65,.28);display:flex;gap:14px;align-items:center;',
    ' border:1.5px solid rgba(255,255,255,.28)}',
    '.tip b{font-weight:700}',
    '.tip u{cursor:pointer;text-decoration:underline;opacity:.8;font-size:13px}',

    /* 작성 상자 */
    '.pop{position:absolute;width:300px;background:#fff;border-radius:10px;pointer-events:auto;',
    ' box-shadow:0 10px 34px rgba(12,33,65,.26);border:1px solid #E3E8F0;overflow:hidden}',
    '.pop h4{font-size:13px;color:#5A6478;padding:12px 14px 0;font-weight:600}',
    '.pop .note{padding:4px 14px 0;font-size:11.5px;line-height:1.5;color:#8A93A3}',
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
    '.panel{overscroll-behavior:contain}',
    /* 머리는 어두운 면으로 눌러 둔다. 목록이 흰 바탕이라 위아래가 갈린다. */
    '.ph{padding:16px 18px;background:#141A26;display:flex;align-items:center;gap:10px}',
    '.ph h3{font-size:15px;color:#fff;flex:1;font-weight:700}',
    /*
     * 목록의 스크롤 막대.
     *
     * 기본 막대는 옅어서 쌓인 것이 더 있는지 눈에 띄지 않았다. 검은 계열로
     * 진하게, 폭도 넓혀 잡기 쉽게 둔다.
     */
    /*
     * 구르는 자리는 머리까지 품는다.
     *
     * 머리를 바깥에 두면 목록만 흐르고 머리는 붙박여 있었다. 쌓인 것을 길게
     * 훑을 때 그만큼 자리를 차지한다. 머리를 안으로 넣어 같이 흐르게 하고,
     * 바닥의 단추만 붙박아 둔다 — 그건 언제든 눌러야 하는 자리다.
     *
     * 목록 끝에 닿아도 뒤 화면으로 넘어가지 않는다.
     */
    '.pscroll{flex:1;overflow-y:auto;overscroll-behavior:contain;',
    ' scrollbar-width:auto;scrollbar-color:#2B3445 #E7EBF1}',
    '.pscroll::-webkit-scrollbar{width:28px}',
    '.pscroll::-webkit-scrollbar-track{background:#E7EBF1}',
    '.pscroll::-webkit-scrollbar-thumb{background:#2B3445;border-radius:999px;',
    ' border:7px solid #E7EBF1}',
    '.pscroll::-webkit-scrollbar-thumb:hover{background:#0C2141}',
    '.pb{padding:6px 0 18px}',
    /* 머리글은 옅은 회색 면에 올려, 쌓인 글과 한 흐름으로 읽히지 않게 둔다. */
    '.grp{padding:12px 18px;background:#EEF1F6;border-bottom:1px solid #DCE2EA;',
    ' font-size:12px;letter-spacing:.04em;color:#5A6475;font-weight:700}',
    '.grp span{display:block;margin-top:5px;font-size:12.5px;font-weight:500;',
    ' letter-spacing:0;line-height:1.5;color:#5A6475}',
    '.grp span b{font-weight:800;color:#0C2141}',
    /*
     * 요청 한 건과 다음 건 사이의 금.
     *
     * 한 건 안에 본문·사진·댓글이 여러 겹 쌓이면서, 옅은 선으로는 어디서
     * 끊기는지 보이지 않았다. 진한 선으로 긋고 위아래 숨을 더 준다.
     * 마지막 건 아래에는 긋지 않는다 — 더 있는 줄 알게 된다.
     */
    '.it{padding:18px;border-bottom:2px solid #141A26;cursor:pointer}',
    '.rq{margin:-18px -18px 0;padding:18px;background:#F2F4F7}',
    '.it:last-child{border-bottom:0}',
    '.it:hover{background:#F7F9FC}',
    '.it.blink{animation:asogblink .8s ease-in-out 2}',
    '@keyframes asogblink{0%,100%{background:transparent}50%{background:#FFE400}}',
    '.it .top{display:flex;align-items:center;gap:8px;margin-bottom:5px}',
    /* 번호는 화면의 핀과 짝을 이루는 표시다. 핀만큼 또렷해야 서로 찾는다. */
    /*
     * 목록의 번호도 화면의 핀과 같은 모양으로 둔다.
     *
     * 동그라미와 핀이 서로 다른 것처럼 보였다. 같은 것을 가리키는 표시라면
     * 생김새도 같아야 눈이 바로 잇는다. 꼬리가 왼쪽 아래를 향하도록 돌리고,
     * 숫자는 되돌려 똑바로 세운다.
     */
    '.it .no{flex:none;width:30px;height:30px;border-radius:50% 50% 50% 4px;',
    ' transform:rotate(-45deg);display:inline-flex;align-items:center;justify-content:center;',
    ' font-size:14px;font-weight:800;color:#fff;background:#8A93A3;border:2px solid #fff;',
    ' box-shadow:0 3px 8px rgba(12,33,65,.3);margin:2px 4px 2px 2px}',
    '.it .no i{transform:rotate(45deg);font-style:normal;letter-spacing:-.02em}',
    /* 눌러서 그 자리로 간다 — 화면의 핀과 같은 일을 한다 */
    '.it .no{cursor:pointer;transition:scale .12s ease}',
    '.it .no:hover{scale:1.14}',
    '.it .st{font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px;border:1px solid currentColor}',
    '.it .so{font-size:11px;font-weight:700;color:#B07800;background:#FFF6E0;border-radius:999px;padding:2px 8px}',
    '.it .ago{margin-left:auto;font-size:12px;color:#8A93A3;flex:none}',
    '.it p{font-size:14.5px;line-height:1.55;color:#0C2141;white-space:pre-wrap;word-break:break-word}',
    '.it .who{margin-top:5px;font-size:12px;color:#8A93A3}',
    '.it .who .by{font-weight:800;color:#5A6475}',
    '.it .who .by.a{color:' + ASOG_BLUE + '}',
    '.it .rep{margin-top:8px;padding:9px 11px;background:#EAF1FF;border-radius:7px;font-size:13.5px;',
    ' line-height:1.55;color:#0C2141;white-space:pre-wrap}',
    '.it .rep b{display:block;font-size:11px;letter-spacing:.06em;color:' + BRAND + ';margin-bottom:3px}',

    /* 주고받은 말 — 왼쪽 선 색으로 누가 썼는지 가른다 */
    '.th{margin-top:14px;display:flex;flex-direction:column;gap:7px}',
    /*
     * 누가 썼는지 면 색으로 가른다.
     *
     * 고객은 옅은 회색, 어소그는 푸른색. 도구 자체가 보라라, 댓글까지 보라로
     * 두면 "도구가 쓴 글"처럼 읽혔다. 푸른색은 도구 색과 섞이지 않아 글쓴이
     * 표시로만 읽힌다.
     */
    '.ln{padding:7px 10px;border-left:3px solid #CFD6E0;background:#F2F4F7;border-radius:0 7px 7px 0}',
    '.ln.a{border-left-color:' + ASOG_BLUE + ';background:#E9F1FF}',
    '.ln b{display:block;font-size:11px;letter-spacing:.04em;color:#8A93A3;margin-bottom:2px}',
    '.ln.a b{color:' + ASOG_BLUE + '}',
    '.ln span{display:block;font-size:13.5px;line-height:1.55;color:#0C2141;white-space:pre-wrap;word-break:break-word}',
    '.ln i{display:block;margin-top:3px;font-size:11px;font-style:normal;color:#A8B0BE}',
    /* 붙임 그림 — 목록에서는 작게, 누르면 크게 */
    '.shots{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}',
    '.shot{width:62px;height:62px;object-fit:cover;border-radius:7px;cursor:zoom-in;',
    ' border:1px solid #E3E8F0;background:#F1F4F9}',
    '.shot:hover{border-color:' + BRAND + '}',
    '.lb{position:fixed;inset:0;z-index:10;background:rgba(12,33,65,.82);pointer-events:auto;',
    ' display:flex;align-items:center;justify-content:center;padding:28px;cursor:zoom-out}',
    '.lb img{max-width:100%;max-height:100%;border-radius:10px;',
    ' box-shadow:0 20px 60px rgba(0,0,0,.45);background:#fff}',
    '.lbx{position:absolute;top:14px;right:16px;width:40px;height:40px;border:0;border-radius:999px;',
    ' background:rgba(255,255,255,.92);color:#0C2141;font-size:24px;line-height:1;cursor:pointer}',

    /* 사진 고르기 */
    '.pick{display:inline-flex;align-items:center;gap:6px;margin:8px 14px 4px;padding:7px 12px;',
    ' border:1.5px dashed #D5DCE8;border-radius:7px;font-size:13px;font-weight:600;',
    ' color:#5A6475;cursor:pointer}',
    '.pick:hover{border-color:' + BRAND + ';color:' + BRAND + '}',
    '.pick.sm{flex:none;margin-top:0;padding:0 11px;height:38px;white-space:nowrap}',
    '.pick em{font-style:normal;font-weight:500;font-size:11.5px;color:#8A93A3}',
    '.picked{margin-left:8px;font-size:12px;color:' + BRAND + ';font-weight:700}',

    /* 줄마다 붙는 작은 글수정·삭제 */
    '.ln .lnact{display:flex;gap:6px;margin-top:7px;font-style:normal}',
    '.ln .lnact a{display:inline-flex;align-items:center;justify-content:center;',
    ' padding:5px 11px;border:1.5px solid #D5DCE8;border-radius:6px;background:#fff;',
    ' font-size:12px;font-weight:600;line-height:1;color:#0C2141;cursor:pointer;',
    ' text-decoration:none;transition:background .12s,border-color .12s}',
    '.ln .lnact a:hover{background:#0C2141;border-color:#0C2141;color:#fff}',
    '.ln .lnact a:active{transform:translateY(1px)}',
    '.ln .lnact a[data-act="saydel"]{color:#C8102E;border-color:#EFD3D8}',
    '.ln .lnact a[data-act="saydel"]:hover{background:#C8102E;border-color:#C8102E;color:#fff}',
    '.ln textarea{width:100%;margin-top:2px;padding:7px 9px;border:1.5px solid #D5DCE8;',
    ' border-radius:6px;font:inherit;font-size:13.5px;line-height:1.55;color:#0C2141;',
    ' background:#fff;resize:vertical}',
    '.ln textarea:focus{outline:none;border-color:' + BRAND + '}',

    /* 답장 칸 */
    '.say{margin-top:12px;padding-top:12px;border-top:1px dashed #7A8498;',
    ' display:flex;gap:6px;align-items:flex-end}',
    '.say textarea{flex:1;min-height:38px;max-height:120px;padding:9px 10px;border:1.5px solid #D5DCE8;',
    ' border-radius:7px;font:inherit;font-size:13.5px;line-height:1.5;color:#0C2141;resize:vertical;background:#fff}',
    '.say textarea:focus{outline:none;border-color:' + BRAND + '}',
    /*
     * 보내기 단추도 글쓴이를 따라간다.
     *
     * 고객은 진한 회색, 어소그는 옅은 파랑. 쌓인 글의 면 색과 같은 편으로
     * 두어, 누르기 전에 이미 "어느 쪽으로 적히는지" 보인다.
     */
    '.say a{flex:none;display:inline-flex;align-items:center;padding:0 14px;height:38px;border-radius:7px;',
    ' font-size:13.5px;font-weight:800;background:#141A26;color:#fff;cursor:pointer}',
    '.say a:hover{background:#000}',
    '.say a.asog{background:#1F5FD0;color:#fff}',
    '.say a.asog:hover{background:#17489E}',

    /* 어소그 확인 번호를 묻는 카드 */
    '.gate{position:fixed;inset:0;background:rgba(12,33,65,.5);pointer-events:auto;',
    ' display:flex;align-items:center;justify-content:center;padding:20px}',
    '.gc{width:320px;max-width:100%;background:#fff;border-radius:12px;padding:22px;',
    ' box-shadow:0 18px 50px rgba(12,33,65,.34)}',
    '.gc h4{font-size:17px;font-weight:700;color:#0C2141;margin-bottom:7px}',
    '.gc p{font-size:13.5px;line-height:1.6;color:#5A6475;margin-bottom:14px}',
    '.gc input{width:100%;padding:12px 14px;border:1.5px solid #D5DCE8;border-radius:8px;',
    ' font:inherit;font-size:20px;letter-spacing:.3em;text-align:center;color:#0C2141}',
    '.gc input:focus{outline:none;border-color:' + BRAND + '}',
    '.ge{min-height:18px;margin-top:6px;font-size:12.5px;color:#C8102E}',
    '.gc .row{display:flex;gap:8px;margin-top:6px}',
    '.gc .row .btn{flex:1;justify-content:center;box-shadow:none}',

    /* 지금 누구로 쓰는지 */
    '.ph .me{margin-left:auto;flex:none;font-size:12px;font-weight:800;letter-spacing:.02em;',
    ' color:#E7EBF1;background:rgba(255,255,255,.14);border:1.5px solid rgba(255,255,255,.3);',
    ' border-radius:999px;padding:4px 11px;max-width:150px;overflow:hidden;',
    ' text-overflow:ellipsis;white-space:nowrap}',
    '.ph .me.asog{color:#fff;background:' + BRAND + ';border-color:' + BRAND + '}',
    /*
     * 맨 처음 글의 단추는 색을 채운다.
     *
     * 댓글의 단추와 모양이 같으면 어느 글을 고치는 것인지 헷갈린다. 면을
     * 채워 "이 카드의 주인 글"임을 알리고, 댓글 쪽은 선만 있는 작은 단추로
     * 남겨 위아래 위계를 세운다.
     */
    /*
     * 단추 줄 아래와 답장 칸 위를 점선으로 끊는다.
     *
     * 맨 처음 글과 주고받은 말, 그리고 새로 적는 칸이 한 덩어리로 흘렀다.
     * 요청 사이를 가르는 실선과 달리 점선으로 둬, 같은 요청 안에서 나뉘는
     * 자리라는 것이 보이게 한다.
     */
    /* 회색 면이 이미 끊어 주므로 여기는 점선을 긋지 않는다. */
    '.it .acts{margin-top:10px;display:flex;gap:8px}',
    '.it .acts a{display:inline-flex;align-items:center;justify-content:center;',
    ' padding:8px 16px;border-radius:7px;font-size:13.5px;font-weight:700;line-height:1;',
    ' background:#6B7488;color:#fff;border:1.5px solid #6B7488;cursor:pointer;',
    ' text-decoration:none;transition:background .12s,border-color .12s}',
    /* 평소엔 물러서 있다가, 올리면 제 색을 낸다 */
    '.it .acts a:hover{background:#0C2141;border-color:#0C2141}',
    '.it .acts a:active{transform:translateY(1px)}',
    '.it .acts a[data-act="del"]{background:#D98090;border-color:#D98090;color:#fff}',
    '.it .acts a[data-act="del"]:hover{background:#C8102E;border-color:#C8102E}',
    /* 화면 이동은 고치는 일이 아니라 옮기는 일이라 선만 둔다 */
    '.it .acts a.go{background:#fff;color:#0C2141;border-color:#9AA5B5}',
    '.it .acts a.go:hover{background:#0C2141;border-color:#0C2141;color:#fff}',
    '.it .lost{margin-top:6px;font-size:12px;color:#B07800}',
    '.empty{padding:34px 20px;text-align:center;color:#8A93A3;font-size:14px;line-height:1.7}',
    /* 목록 바닥 — 다음에 할 일을 한 자리에 둔다 */
    /*
     * 쌓인 목록과 「다음에 할 일」 사이의 금.
     *
     * 목록 맨 끝 요청과 단추가 이어져 보여, 그 단추가 마지막 요청에 딸린
     * 것처럼 읽혔다. 요청 사이를 가르는 금과 같은 굵기로 끊는다.
     */
    /* 바닥도 머리와 같은 어두운 면으로 눌러, 목록이 그 사이에 놓이게 한다. */
    '.pact{padding:14px 18px;background:#141A26}',
    '.pact .btn{width:100%;justify-content:center;text-align:center;box-shadow:none}',
    /* 바로가기는 둘을 나란히 둔다. 고르는 단추보다 조용해야 한다. */
    '.pgo{display:flex;gap:6px;margin-top:6px}',
    '.pgo .btn{flex:1;display:inline-flex;align-items:center;justify-content:center;',
    ' padding:9px 0;font-size:13px;text-decoration:none;white-space:nowrap;',
    ' background:transparent;color:#E7EBF1;border:1px solid rgba(255,255,255,.34)}',
    '.pgo .btn:hover{background:rgba(255,255,255,.12)}',
    /* 어소그에게만 보이는 자리는 색으로도 갈라 둔다. */
    '.pgo .btn.asog{border-color:' + BRAND + ';color:#E2B6FF}',
    '.pgo .btn.asog:hover{background:rgba(176,38,255,.22)}',
    '.pf{padding:0 18px 14px;background:#141A26;font-size:12px;color:#9AA3B2;line-height:1.6}',
    '.pf b{color:#E7EBF1}',

    '@media (max-width:560px){',
    ' .tab{width:46px;padding:20px 0}',
    /* 패널이 화면을 다 덮으므로 비켜설 자리가 없다. 왼쪽 가장자리에 세운다. */
    ' .tab.is-open{right:auto;left:0;width:46px;border-radius:0 999px 999px 0;',
    '  border-left:0;border-right:2px solid #fff;',
    '  box-shadow:8px 0 26px rgba(176,38,255,.42),0 3px 14px rgba(12,33,65,.3)}',
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
  /*
   * 화면에 늘 떠 있는 것은 목록 손잡이 하나뿐이다.
   *
   * 「수정할곳 선택하기」는 목록 안으로 들여보냈다. 두 단추가 나란히 떠 있으면
   * 시안을 가리는 데다, 무엇부터 눌러야 하는지 갈리지 않았다. 손잡이 → 목록 →
   * 고를 곳 고르기 한 줄기로 읽힌다.
   *
   * 손잡이는 오른쪽 가운데 모서리에 붙어 반만 내민 모양이다. 화살표가 열리는
   * 쪽(왼쪽)을 가리킨다.
   */
  function renderFab() {
    /*
     * 손잡이 하나로 열고 닫는다.
     *
     * 열려 있을 때 손잡이를 감췄더니, 닫으려면 패널 안의 작은 ×를 찾아야 했다.
     * 연 자리에서 그대로 닫는 편이 손이 덜 간다. 열리면 패널 왼쪽으로 비켜서서
     * 화살표 대신 ×를 보인다.
     */
    ui.innerHTML =
      '<button class="tab' + (panelOpen ? " is-open" : "") + '" id="list" title="' +
        (panelOpen ? "목록 닫기" : "수정 요청 목록 열기") + '">' +
        (panelOpen
          ? '<span class="ar">×</span><span class="lbl">닫기</span>'
          : '<span class="ar">‹</span>') +
      '</button>' +
      (placing
        ? '<div class="tip"><b>고치고 싶은 곳을 클릭하세요</b><u id="stop">취소 (Esc)</u></div>'
        : '');

    var lst = ui.querySelector("#list");
    if (lst) lst.onclick = function () { panelOpen ? closePanel() : openPanel(true); };
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
    // 자리를 아주 잃은 핀은 오른쪽 가장자리에 차곡차곡 세운다. 번호가
    // 화면에서 사라지면 고객은 자기가 적은 것이 지워진 줄 안다.
    var docked = 0;
    items.forEach(function (it) {
      if (!samePage(it)) return;
      var pt = sameView(it) ? pointOf(it) : null;
      var st = STATUS[it.status] || STATUS["new"];
      var el = document.createElement("div");
      el.className = "pin" + (pt ? (pt.exact ? "" : " near") : " lost");
      el.style.setProperty("--c", hueOf(it));
      if (pt) {
        el.style.left = (pt.x - window.pageXOffset) + "px";
        el.style.top = (pt.y - window.pageYOffset) + "px";
        el.title = "#" + it.num + " · " + st.label +
                   (pt.exact ? "" : " · 가까운 자리에 세웠습니다");
      } else {
        el.style.left = (window.innerWidth - 42) + "px";
        el.style.top = (210 + docked * 54) + "px";
        el.title = "#" + it.num + " · " + st.label +
                   (sameView(it) ? " · 이 자리는 지금 화면에 없습니다"
                                 : " · 다른 탭에서 적었습니다 — 눌러서 그 화면으로");
        docked++;
      }
      el.innerHTML = "<span>" + it.num + "</span>";
      el.onmouseenter = function () { if (pt) showBox(it); };
      el.onmouseleave = hideBox;
      el.onclick = function (e) {
        e.stopPropagation();
        // 다른 탭에서 적은 핀은 그 화면으로 데려다준다.
        if (!sameView(it)) { location.href = it.path; return; }
        if (pt) showBox(it, true);
        openPanel(true, it.id);
      };
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
      '<h4>' + (editingId ? "글 수정" : "무엇을 고칠까요?") + '</h4>' +
      (editingId ? '<p class="note">이미 붙인 그림은 그대로 두고, 고른 것만 더합니다</p>' : '') +
      '<textarea id="t" placeholder="예) 이 버튼 색이 너무 흐려서 잘 안 보입니다"></textarea>' +
      '<input id="a" placeholder="작성하신 분 (선택)" value="' + esc(author) + '">' +
      '<label class="pick">참고 이미지 첨부<em>최대 5장</em>' +
        '<input id="f" type="file" accept="image/*" multiple hidden>' +
      '</label><span class="picked" id="fn"></span>' +
      '<div class="row">' +
        '<button class="btn ghost" id="c">취소</button>' +
        '<button class="btn main" id="s">' + (editingId ? "저장" : "보내기") + '</button>' +
      '</div>';
    ui.appendChild(pop);

    var ta = pop.querySelector("#t");
    if (draft.body) ta.value = draft.body;
    setTimeout(function () { ta.focus(); }, 30);

    var fileInput = pop.querySelector("#f");
    if (fileInput) {
      fileInput.onchange = function () {
        var n = fileInput.files.length;
        pop.querySelector("#fn").textContent = !n ? ""
          : n > IMG_MAX ? IMG_MAX + "장만 올립니다 (" + n + "장 고름)"
          : n + "장 고름";
      };
    }

    pop.querySelector("#c").onclick = function () { editingId = null; closePop(); };
    pop.querySelector("#s").onclick = send;
    ta.addEventListener("keydown", function (e) {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") send();
    });

    function send() {
      var body = ta.value.trim();
      var files = fileInput ? fileInput.files : null;
      /* 글이 비어도 그림만 붙여 남길 수 있다 */
      if (!body && !(files && files.length)) { ta.focus(); return; }
      author = pop.querySelector("#a").value.trim();
      if (!isAsog) {
        try { localStorage.setItem("asog_pin_author", author); } catch (e) {}
      }

      var btn = pop.querySelector("#s");
      btn.disabled = true; btn.textContent = "보내는 중…";

      var done = function (row) {
        btn.disabled = false;
        if (!row) { btn.textContent = "다시 시도"; return; }
        editingId = null;
        closePop();
        load();
      };

      if (files && files.length) btn.textContent = "사진 올리는 중…";
      uploadAll(files).then(function (images) {
        btn.textContent = "보내는 중…";

        if (editingId) {
          return rpc("fb_edit", {
            p_key: KEY, p_id: editingId, p_body: body, p_images: images
          }).then(done);
        }

        rpc("fb_add", {
          p_key: KEY,
          p_item: {
            path: pathNow(), url: location.href,
            selector: draft.selector, x_pct: draft.x_pct, y_pct: draft.y_pct,
            vw: window.innerWidth, device: isMobile() ? "mobile" : "pc",
            ua: navigator.userAgent, body: body, author: author, images: images,
            by_asog: isAsog
          }
        }).then(done);
      });
    }
  }

  /* ── 목록 패널 ───────────────────────────────────────── */
  var panel = null;
  function closePanel() {
    panelOpen = false;
    if (panel) { panel.classList.remove("on"); var p = panel; panel = null; setTimeout(function () { p.remove(); }, 240); }
    renderFab();
  }

  function openPanel(on, focusId) {
    if (!on) return closePanel();
    closePop();
    if (panel) panel.remove();
    panelOpen = true;

    panel = document.createElement("div");
    panel.className = "panel";
    renderFab();

    var here = [], other = [];
    visibleItems().forEach(function (i) { (samePage(i) ? here : other).push(i); });

    panel.innerHTML =
      '<div class="pscroll"><div class="ph">' +
      '<h3>수정 요청 ' + visibleItems().length + '건' +
        (company ? ' · ' + esc(company) : '') + '</h3>' +
      /*
       * 지금 누구로 쓰는지.
       *
       * 전에는 작성자 이름을 띄웠더니, 이름을 적어 둔 고객 화면에 그 이름만
       * 보여 어느 쪽인지 알 수 없었다. 역할을 먼저 적고 이름은 뒤에 붙인다.
       * 색도 함께 간다 — 고객은 회색, 어소그는 보라.
       */
      '<span class="me' + (isAsog ? " asog" : "") + '">' +
        (isAsog ? "ASOG" : "고객") +
        (!isAsog && author ? ' · ' + esc(author) : '') +
      '</span>' +
      '</div>' +
      '<div class="pb" id="pb"></div>' +
      '</div>' +
      '<div class="pact">' +
        '<button class="btn main" id="add">수정할곳 선택하기</button>' +
        (DASH_URL || ADMIN_URL
          ? '<div class="pgo">' +
              (DASH_URL
                ? '<a class="btn ghost" href="' + esc(DASH_URL) + '" target="_blank" rel="noopener noreferrer">현황 화면 보기 ↗</a>'
                : '') +
              (ADMIN_URL
                ? '<a class="btn ghost" href="' + esc(ADMIN_URL) + '" target="_blank" rel="noopener noreferrer">관리자 화면 보기 ↗</a>'
                : '') +
            '</div>' +
            /* 스튜디오는 어소그가 처리하는 자리라 어소그로 열었을 때만 보인다. */
            (isAsog && STUDIO_URL
              ? '<div class="pgo"><a class="btn ghost asog" href="' + esc(STUDIO_URL) +
                '" target="_blank" rel="noopener noreferrer">스튜디오 보기 ↗</a></div>'
              : '')
          : '') +
      '</div>' +
      '<div class="pf">핀을 눌러 그 자리로 이동할 수 있습니다. ' +
      '<b>접수</b> 상태인 요청은 직접 글수정하거나 삭제할 수 있습니다.</div>';
    ui.appendChild(panel);
    setTimeout(function () { if (panel) panel.classList.add("on"); }, 10);

    /*
     * 패널 위에서 굴린 바퀴는 패널 안에서만 쓴다.
     *
     * 두 가지를 막는다.
     *  1) 구를 것이 없는 자리(머리·바닥)에서는 바퀴를 삼킨다. 안 그러면 그대로
     *     뒤 화면으로 넘어가 사이트가 움직인다.
     *  2) 어디서 굴리든 바깥으로 흘려보내지 않는다. 사이트가 휠을 가로채
     *     화면을 통째로 넘기는 경우(풀페이지 스크롤)가 있는데, 그러면 목록
     *     위에서 굴려도 사이트가 다음 섹션으로 넘어가 버린다.
     */
    panel.addEventListener("wheel", function (e) {
      e.stopPropagation();
      var inList = e.target && e.target.closest && e.target.closest(".pscroll");
      if (!inList) e.preventDefault();
    }, { passive: false });

    var addBtn = panel.querySelector("#add");
    if (addBtn) addBtn.onclick = function () { setPlacing(true); };

    var pb = panel.querySelector("#pb"), html = "";
    if (!here.length && !other.length) {
      html = '<div class="empty">아직 등록된 수정 요청이 없습니다.<br>' +
             '아래 <b>수정할곳 선택하기</b>를 누른 뒤 고치고 싶은 곳을 클릭해 보세요.</div>';
    } else {
      /*
       * 지금 보고 있는 화면의 것은 머리글 없이 바로 세운다. 목록을 열면 먼저
       * 보이는 것이 그것들이라, 따로 이름 붙일 일이 아니다. 다른 화면의 것만
       * 어디서부터인지 알린다.
       */
      html += here.map(card).join("");
      if (other.length) {
        html += '<div class="grp">다른 페이지 (' + other.length + ')</div>' + other.map(card).join("");
      }
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
        /* ── 댓글 한 줄 고치기·지우기 ── */
        if (act === "sayedit" || act === "saydel" || act === "saysave" || act === "saycancel") {
          e.stopPropagation();
          var ln = e.target.closest ? e.target.closest(".ln") : null;
          var at = ln && ln.getAttribute("data-at");
          if (!at) return;

          if (act === "sayedit") { editingSay = { id: id, at: at }; return openPanel(true, id); }
          if (act === "saycancel") { editingSay = null; return openPanel(true, id); }

          if (act === "saydel") {
            if (!confirm("이 댓글을 삭제할까요?")) return;
            e.target.textContent = "지우는 중…";
            return rpc("fb_say_del", { p_key: KEY, p_id: id, p_at: at, p_as_asog: isAsog })
              .then(function () { editingSay = null; load().then(function () { openPanel(true, id); }); });
          }

          var ta = ln.querySelector("[data-sayedit]");
          var txt = (ta && ta.value || "").trim();
          if (!txt) { if (ta) ta.focus(); return; }
          e.target.textContent = "저장 중…";
          return rpc("fb_say_edit", {
            p_key: KEY, p_id: id, p_at: at, p_text: txt, p_as_asog: isAsog
          }).then(function () {
            editingSay = null;
            load().then(function () { openPanel(true, id); });
          });
        }

        if (act === "say") {
          e.stopPropagation();
          var ta = el.querySelector("[data-say]");
          var sf = el.querySelector("[data-sayfile]");
          var txt = (ta && ta.value || "").trim();
          var sfiles = sf ? sf.files : null;
          if (!txt && !(sfiles && sfiles.length)) { if (ta) ta.focus(); return; }
          var sayBtn = e.target;
          sayBtn.textContent = sfiles && sfiles.length ? "사진 올리는 중…" : "보내는 중…";
          uploadAll(sfiles).then(function (images) {
            sayBtn.textContent = "보내는 중…";
            return rpc("fb_say", {
              p_key: KEY, p_id: id, p_text: txt,
              p_name: author, p_as_asog: isAsog, p_images: images
            });
          }).then(function (row) {
            if (!row) { sayBtn.textContent = "다시"; return; }
            load().then(function () { openPanel(true, id); });
          });
          return;
        }
        /* 목록의 핀을 눌러도 「화면 이동」과 같이 그 자리로 간다. */
        if (e.target && e.target.closest && e.target.closest(".no")) {
          e.stopPropagation();
          goSpot(it);
          return;
        }
        if (act === "goto") {
          e.stopPropagation();
          goSpot(it);
          return;
        }
        if (act === "del") {
          e.stopPropagation();
          if (!confirm("#" + it.num + " 요청을 삭제할까요?")) return;
          rpc("fb_remove", { p_key: KEY, p_id: id }).then(function () { load(); });
          return;
        }
        if (e.target && e.target.classList && e.target.classList.contains("shot")) {
          e.stopPropagation();
          openShot(e.target.getAttribute("src"));
          return;
        }
        if (e.target && e.target.hasAttribute &&
            (e.target.hasAttribute("data-say") || e.target.hasAttribute("data-sayedit"))) {
          e.stopPropagation();
          return;
        }
        goTo(it);
      };
    });


    if (focusId) {
      var t = pb.querySelector('.it[data-id="' + focusId + '"]');
      if (t) {
        t.scrollIntoView({ block: "center" });
        /* 어느 글인지 면을 두 번 깜박여 알린다. 화면을 건드리지 않는다. */
        t.classList.add("blink");
        setTimeout(function () { t.classList.remove("blink"); }, 1600);
      }
    }
  }

  function card(it) {
    var st = STATUS[it.status] || STATUS["new"];
    var pt = samePage(it) ? pointOf(it) : true;
    return '<div class="it" data-id="' + it.id + '">' +
      /*
       * 맨 처음 적은 글은 회색 면에 올려 둔다. 그 아래 주고받은 말과 새로
       * 적는 칸은 흰 면이라, 어디까지가 "처음 요청"인지 면으로 갈린다.
       */
      '<div class="rq">' +
      '<div class="top">' +
        '<span class="no" style="background:' + hueOf(it) + '"><i>' + it.num + '</i></span>' +
        /*
         * 「접수」만 검은 글자로 둔다.
         *
         * 번호가 이미 그 색을 쓰고 있어, 배지까지 같은 색이면 한 덩어리로
         * 뭉쳐 보였다. 아직 손대지 않은 상태라는 뜻이라 색으로 재촉할 일도
         * 아니다. 작업 중·완료·협의 필요는 제 색을 그대로 쓴다.
         */
        '<span class="st" style="color:' +
          (it.status === "new" ? "#141A26" : st.color) + '">' + st.label + '</span>' +
        (it.scope_out ? '<span class="so">별도 협의</span>' : '') +
        '<span class="ago">' + when(it.created_at) + '</span>' +
      '</div>' +
      '<p>' + esc(it.body) + '</p>' +
      shots(it.images) +
      /*
       * 누가 남겼는지 먼저 적는다.
       *
       * 이름을 비워 두는 사람이 많아, 적힌 것이 없으면 자리만 보였다. 적어도
       * 어느 편인지는 늘 보이게 「고객」·「ASOG」를 세우고, 이름을 적었으면
       * 그 뒤에 붙인다.
       */
      '<div class="who">' +
        '작성자: <b class="by' + (it.by_asog ? ' a' : '') + '">' +
          esc(it.by_asog ? "어소그" : (it.author || "고객")) +
        '</b>' +
        ' · ' + esc(it.path) +
      '</div>' +
      /*
       * 글수정·삭제는 그 글 바로 아래 둔다.
       *
       * 전에는 카드 맨 아래에 있어서, 주고받은 말이 길어지면 맨 처음 글에서
       * 한참 떨어졌다. 그 자리에서는 어느 글을 고치는 단추인지 흐려진다.
       */
      '<div class="acts">' +
        (it.status === "new"
          ? '<a data-act="edit">글수정</a><a data-act="del">삭제</a>'
          : '') +
        '<a data-act="goto" class="go">화면 이동</a>' +
      '</div>' +
      '</div>' +
      thread(it) +
      (!pt ? '<div class="lost">' + (samePage(it) && !sameView(it)
              ? '다른 탭에서 적은 자리입니다 — 눌러서 그 화면으로 갑니다'
              : '이 자리는 지금 화면에 없습니다 — 번호는 오른쪽 가장자리에 세워 두었습니다') + '</div>' : '') +
      /*
       * 답장은 양쪽 다 쓴다.
       *
       * 한 건 안에서 주고받아야 "그 자리에 대한 이야기"가 흩어지지 않는다.
       * 고객이 되물을 때마다 핀을 새로 찍게 하면 같은 자리에 번호가 여럿
       * 생겨, 정작 어느 것이 결론인지 찾기 어려워진다.
       */
      '<div class="say">' +
        '<textarea data-say rows="1" placeholder="댓글을 작성하세요."></textarea>' +
        '<label class="pick sm">사진<input data-sayfile type="file" accept="image/*" multiple hidden></label>' +
        '<a data-act="say"' + (isAsog ? ' class="asog"' : '') + '>보내기</a>' +
      '</div>' +
    '</div>';
  }

  /*
   * 주고받은 말.
   *
   * 고객이 쓴 줄과 ASOG가 쓴 줄을 왼쪽 선 색과 이름으로 가른다. 한쪽을
   * 오른쪽으로 붙이는 대화창 모양은 쓰지 않는다 — 글이 길어 금세 읽기
   * 어려워진다.
   */
  /*
   * 지금 고치고 있는 댓글 한 줄. {id, at}
   *
   * 줄은 번호가 아니라 적힌 시각으로 가린다. 번호로 잡으면 그 사이에 다른
   * 줄이 지워졌을 때 엉뚱한 줄을 건드린다.
   */
  var editingSay = null;

  function thread(it) {
    var th = Array.isArray(it.thread) ? it.thread : [];
    if (!th.length && it.reply) th = [{ who: "asog", name: "ASOG", text: it.reply, at: it.updated_at }];
    if (!th.length) return "";
    return '<div class="th">' + th.map(function (m) {
      var fromAsog = m && m.who === "asog";
      var mine = fromAsog === isAsog;   // 자기 쪽 줄만 손댈 수 있다
      var at = esc(m.at || "");
      var editing = editingSay && editingSay.id === it.id && editingSay.at === m.at;

      if (editing) {
        return '<div class="ln' + (fromAsog ? " a" : "") + '" data-at="' + at + '">' +
          '<b>' + esc(fromAsog ? "ASOG" : (m.name || "고객")) + '</b>' +
          '<textarea data-sayedit rows="2">' + esc(m.text) + '</textarea>' +
          '<em class="lnact">' +
            '<a data-act="saysave">저장</a>' +
            '<a data-act="saycancel">취소</a>' +
          '</em></div>';
      }

      return '<div class="ln' + (fromAsog ? " a" : "") + '" data-at="' + at + '">' +
        '<b>' + esc(fromAsog ? "ASOG" : (m.name || "고객")) + '</b>' +
        '<span>' + esc(m.text) + '</span>' +
        shots(m.images) +
        '<i>' + when(m.at) + (m.edited ? " · 고침" : "") + '</i>' +
        (mine
          ? '<em class="lnact">' +
              '<a data-act="sayedit">글수정</a>' +
              '<a data-act="saydel">삭제</a>' +
            '</em>'
          : '') +
        '</div>';
    }).join("") + '</div>';
  }

  /*
   * 그 자리로 데려다준다.
   *
   * 글을 읽다가 실수로 눌러도 화면이 움직이지 않게, 항목을 누르는 것으로는
   * 하지 않는다. 「화면 이동」 단추를 눌렀을 때만 움직인다.
   */
  function goSpot(it) {
    if (!sameView(it)) { location.href = it.path; return; }
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

  /* 항목을 누르는 것만으로는 아무 일도 하지 않는다. */
  function goTo() {}

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

  /*
   * 화면이 다 그려진 뒤에 다시 그린다.
   *
   * 핀은 적어 둔 길로 요소를 찾아 그 자리에 선다. 그런데 요즘 화면은
   * 자바스크립트가 나중에 그리고, 사진도 늦게 온다. 자료를 받은 그 순간에
   * 한 번만 그리면 아직 없는 요소를 못 찾고 그냥 지나친다 — 새로고침하면
   * 핀이 사라졌다가, 목록에서 눌러 스크롤이 일어날 때야 나타난 이유다.
   *
   * 그래서 두 가지를 더한다.
   *  1) 받은 뒤 몇 번 더 그린다. 늦게 오는 것들을 따라잡는다.
   *  2) 화면이 바뀌면 그린다. 사진이 자리를 밀거나 SPA가 다른 화면으로
   *     갈아끼울 때를 잡는다. 너무 자주 불리지 않게 묶어서 처리한다.
   */
  function catchUp() {
    [120, 400, 900, 1800, 3500].forEach(function (ms) {
      setTimeout(renderPins, ms);
    });
  }

  if (window.MutationObserver) {
    var moTick = null;
    new MutationObserver(function () {
      clearTimeout(moTick);
      moTick = setTimeout(renderPins, 250);
    }).observe(document.documentElement, { childList: true, subtree: true });
  }

  /*
   * 사이트 안에서 화면을 옮겨도 주소만 바뀌고 새로고침은 일어나지 않는다.
   * 그때도 핀을 다시 셈해야 그 화면의 것만 남는다.
   */
  (function () {
    var fire = function () { reflow(); catchUp(); };
    window.addEventListener("popstate", fire);
    ["pushState", "replaceState"].forEach(function (name) {
      var orig = history[name];
      if (typeof orig !== "function") return;
      history[name] = function () {
        var out = orig.apply(this, arguments);
        fire();
        return out;
      };
    });
  })();

  /* ── 불러오기 ────────────────────────────────────────── */
  function load() {
    return rpc("fb_list", { p_key: KEY }).then(function (d) {
      if (!d) { items = []; renderFab(); return; }
      company = d.company || "";
      items = d.items || [];
      renderFab();
      renderPins();
      catchUp();
      if (panelOpen) openPanel(true);
    });
  }

  /*
   * 떠 있는 것들(손잡이·핀·작성 상자) 위에서도 바퀴를 바깥으로 흘리지 않는다.
   * 풀페이지 스크롤을 쓰는 화면에서는 그 위에서 굴리기만 해도 화면이 넘어간다.
   */
  ui.addEventListener("wheel", function (e) { e.stopPropagation(); }, { passive: false });
  layer.addEventListener("wheel", function (e) { e.stopPropagation(); }, { passive: false });

  function start() {
    document.body.appendChild(host);
    renderFab();
    askCode();
    load();
    setInterval(load, 60000); // 1분마다 상태·답변 갱신
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();

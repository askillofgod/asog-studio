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

  /* 형광 보라. 고객 사이트가 쓰지 않는 색이라 "얹힌 도구"로 바로 읽힌다. */
  var BRAND = "#B026FF";
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
  function pathNow() { return location.pathname + stripAs(location.search); }
  function pageNow() { return location.pathname; }
  function pageOf(it) { return String(it.path || "").split("?")[0]; }
  function samePage(it) { return pageOf(it) === pageNow(); }
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
    '.tab .n{min-width:28px;padding:3px 8px;border-radius:999px;background:rgba(255,255,255,.28);',
    ' font-size:15px;font-weight:800;line-height:1.3}',
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
    /* 번호는 화면의 핀과 짝을 이루는 표시다. 핀만큼 또렷해야 서로 찾는다. */
    '.it .no{flex:none;width:30px;height:30px;border-radius:50%;display:inline-flex;',
    ' align-items:center;justify-content:center;font-size:15px;font-weight:800;color:#fff;',
    ' background:#8A93A3;box-shadow:0 2px 6px rgba(12,33,65,.22);letter-spacing:-.02em}',
    '.it .st{font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px;border:1px solid currentColor}',
    '.it .so{font-size:11px;font-weight:700;color:#B07800;background:#FFF6E0;border-radius:999px;padding:2px 8px}',
    '.it .ago{margin-left:auto;font-size:12px;color:#8A93A3;flex:none}',
    '.it p{font-size:14.5px;line-height:1.55;color:#0C2141;white-space:pre-wrap;word-break:break-word}',
    '.it .who{margin-top:5px;font-size:12px;color:#8A93A3}',
    '.it .rep{margin-top:8px;padding:9px 11px;background:#EAF1FF;border-radius:7px;font-size:13.5px;',
    ' line-height:1.55;color:#0C2141;white-space:pre-wrap}',
    '.it .rep b{display:block;font-size:11px;letter-spacing:.06em;color:' + BRAND + ';margin-bottom:3px}',

    /* 주고받은 말 — 왼쪽 선 색으로 누가 썼는지 가른다 */
    '.th{margin-top:9px;display:flex;flex-direction:column;gap:7px}',
    '.ln{padding:7px 10px;border-left:3px solid #D5DCE8;background:#F7F9FC;border-radius:0 7px 7px 0}',
    '.ln.a{border-left-color:' + BRAND + ';background:#F8F0FF}',
    '.ln b{display:block;font-size:11px;letter-spacing:.04em;color:#8A93A3;margin-bottom:2px}',
    '.ln.a b{color:' + BRAND + '}',
    '.ln span{display:block;font-size:13.5px;line-height:1.55;color:#0C2141;white-space:pre-wrap;word-break:break-word}',
    '.ln i{display:block;margin-top:3px;font-size:11px;font-style:normal;color:#A8B0BE}',
    /* 줄마다 붙는 작은 글수정·삭제 */
    '.ln .lnact{display:flex;gap:10px;margin-top:5px;font-style:normal}',
    '.ln .lnact a{font-size:11.5px;font-weight:700;color:#8A93A3;cursor:pointer;',
    ' text-decoration:underline;text-underline-offset:2px}',
    '.ln .lnact a:hover{color:#0C2141}',
    '.ln textarea{width:100%;margin-top:2px;padding:7px 9px;border:1.5px solid #D5DCE8;',
    ' border-radius:6px;font:inherit;font-size:13.5px;line-height:1.55;color:#0C2141;',
    ' background:#fff;resize:vertical}',
    '.ln textarea:focus{outline:none;border-color:' + BRAND + '}',

    /* 답장 칸 */
    '.say{margin-top:9px;display:flex;gap:6px;align-items:flex-end}',
    '.say textarea{flex:1;min-height:38px;max-height:120px;padding:9px 10px;border:1.5px solid #D5DCE8;',
    ' border-radius:7px;font:inherit;font-size:13.5px;line-height:1.5;color:#0C2141;resize:vertical;background:#fff}',
    '.say textarea:focus{outline:none;border-color:' + BRAND + '}',
    '.say a{flex:none;display:inline-flex;align-items:center;padding:0 14px;height:38px;border-radius:7px;',
    ' font-size:13.5px;font-weight:600;background:' + BRAND + ';color:#fff;cursor:pointer}',

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
    ' color:#5A6475;background:#EDF1F7;border:1.5px solid #D5DCE8;',
    ' border-radius:999px;padding:4px 11px;max-width:150px;overflow:hidden;',
    ' text-overflow:ellipsis;white-space:nowrap}',
    '.ph .me.asog{color:#fff;background:' + BRAND + ';border-color:' + BRAND + '}',
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
    /* 목록 바닥 — 다음에 할 일을 한 자리에 둔다 */
    '.pact{padding:12px 18px;border-top:1px solid #E9EDF4}',
    '.pact .btn{width:100%;justify-content:center;text-align:center;box-shadow:none}',
    /* 바로가기는 둘을 나란히 둔다. 고르는 단추보다 조용해야 한다. */
    '.pgo{display:flex;gap:6px;margin-top:6px}',
    '.pgo .btn{flex:1;display:inline-flex;align-items:center;justify-content:center;',
    ' padding:9px 0;font-size:13px;text-decoration:none;white-space:nowrap}',
    /* 어소그에게만 보이는 자리는 색으로도 갈라 둔다. */
    '.pgo .btn.asog{border-color:' + BRAND + ';color:' + BRAND + '}',
    '.pf{padding:12px 18px;border-top:1px solid #E9EDF4;font-size:12px;color:#8A93A3;line-height:1.6}',

    '@media (max-width:560px){',
    ' .tab{width:46px;padding:20px 0}',
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
    ui.innerHTML =
      (panelOpen ? '' :
        '<button class="tab" id="list" title="수정 요청 목록 열기">' +
          '<span class="ar">‹</span>' +
          (items.length ? '<span class="n">' + items.length + '</span>' : '') +
        '</button>') +
      (placing
        ? '<div class="tip"><b>고치고 싶은 곳을 클릭하세요</b><u id="stop">취소 (Esc)</u></div>'
        : '');

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
    // 자리를 아주 잃은 핀은 오른쪽 가장자리에 차곡차곡 세운다. 번호가
    // 화면에서 사라지면 고객은 자기가 적은 것이 지워진 줄 안다.
    var docked = 0;
    items.forEach(function (it) {
      if (!samePage(it)) return;
      var pt = sameView(it) ? pointOf(it) : null;
      var st = STATUS[it.status] || STATUS["new"];
      var el = document.createElement("div");
      el.className = "pin" + (pt ? (pt.exact ? "" : " near") : " lost");
      el.style.setProperty("--c", st.color);
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
    items.forEach(function (i) { (samePage(i) ? here : other).push(i); });

    panel.innerHTML =
      '<div class="ph"><h3>수정 요청' + (company ? " · " + esc(company) : "") + '</h3>' +
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
      '<button class="x" id="x">&times;</button></div>' +
      '<div class="pb" id="pb"></div>' +
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

    var addBtn = panel.querySelector("#add");
    if (addBtn) addBtn.onclick = function () { setPlacing(true); };

    var pb = panel.querySelector("#pb"), html = "";
    if (!items.length) {
      html = '<div class="empty">아직 등록된 수정 요청이 없습니다.<br>' +
             '아래 <b>수정할곳 선택하기</b>를 누른 뒤 고치고 싶은 곳을 클릭해 보세요.</div>';
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
          var txt = (ta && ta.value || "").trim();
          if (!txt) { if (ta) ta.focus(); return; }
          e.target.textContent = "보내는 중…";
          rpc("fb_say", {
            p_key: KEY, p_id: id, p_text: txt,
            p_name: author, p_as_asog: isAsog
          }).then(function (row) {
            if (!row) { e.target.textContent = "다시"; return; }
            load().then(function () { openPanel(true, id); });
          });
          return;
        }
        if (act === "del") {
          e.stopPropagation();
          if (!confirm("#" + it.num + " 요청을 삭제할까요?")) return;
          rpc("fb_remove", { p_key: KEY, p_id: id }).then(function () { load(); });
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

    panel.querySelector("#x").onclick = function () { closePanel(); };

    if (focusId) {
      var t = pb.querySelector('.it[data-id="' + focusId + '"]');
      if (t) t.scrollIntoView({ block: "center" });
    }
  }

  function card(it) {
    var st = STATUS[it.status] || STATUS["new"];
    var pt = samePage(it) ? pointOf(it) : true;
    return '<div class="it" data-id="' + it.id + '">' +
      '<div class="top">' +
        '<span class="no" style="background:' + st.color + '">' + it.num + '</span>' +
        '<span class="st" style="color:' + st.color + '">' + st.label + '</span>' +
        (it.scope_out ? '<span class="so">별도 협의</span>' : '') +
        '<span class="ago">' + when(it.created_at) + '</span>' +
      '</div>' +
      '<p>' + esc(it.body) + '</p>' +
      '<div class="who">' + (it.author ? esc(it.author) + " · " : "") + esc(it.path) + '</div>' +
      thread(it) +
      (!pt ? '<div class="lost">' + (samePage(it) && !sameView(it)
              ? '다른 탭에서 적은 자리입니다 — 눌러서 그 화면으로 갑니다'
              : '이 자리는 지금 화면에 없습니다 — 번호는 오른쪽 가장자리에 세워 두었습니다') + '</div>' : '') +
      (it.status === "new"
        ? '<div class="acts"><a data-act="edit">글수정</a><a data-act="del">삭제</a></div>'
        : '') +
      /*
       * 답장은 양쪽 다 쓴다.
       *
       * 한 건 안에서 주고받아야 "그 자리에 대한 이야기"가 흩어지지 않는다.
       * 고객이 되물을 때마다 핀을 새로 찍게 하면 같은 자리에 번호가 여럿
       * 생겨, 정작 어느 것이 결론인지 찾기 어려워진다.
       */
      '<div class="say">' +
        '<textarea data-say rows="1" placeholder="답장 쓰기"></textarea>' +
        '<a data-act="say">보내기</a>' +
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

  function goTo(it) {
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

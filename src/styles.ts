// 전역 CSS — Shadow DOM <style> 로 주입(soksak chrome 오염 0). 인라인 대신 클래스 — 뷰 2곳 공유.
export const GLOBAL_CSS = `
:host { all: initial; }
.vt-root {
  position: absolute; inset: 0; display: flex; flex-direction: column;
  font: 13px/1.5 system-ui, sans-serif; color: #e8e8ee; background: transparent;
  overflow: hidden;
}
.vt-stage { position: relative; flex: 1 1 60%; min-height: 120px; }
.vt-stage canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
.vt-stage-empty {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  color: #9a9aa6; text-align: center; padding: 24px; white-space: pre-wrap;
}
.vt-subtitle {
  min-height: 22px; padding: 4px 12px; text-align: center; color: #ffd9e8;
  text-shadow: 0 1px 2px rgba(0,0,0,.6); font-size: 14px;
}
.vt-chat { flex: 1 1 40%; min-height: 80px; overflow-y: auto; padding: 8px 10px; display: flex; flex-direction: column; gap: 6px; }
.vt-msg { max-width: 86%; padding: 6px 10px; border-radius: 10px; white-space: pre-wrap; word-break: break-word; }
.vt-msg.user { align-self: flex-end; background: #2c3a55; }
.vt-msg.char { align-self: flex-start; background: #3a2c40; }
.vt-msg.sys { align-self: center; background: transparent; color: #9a9aa6; font-size: 12px; }
.vt-inputrow { display: flex; gap: 6px; padding: 8px; border-top: 1px solid rgba(255,255,255,.08); }
.vt-input {
  flex: 1; padding: 7px 10px; border-radius: 8px; border: 1px solid rgba(255,255,255,.14);
  background: rgba(255,255,255,.06); color: inherit; outline: none; font: inherit;
}
.vt-btn {
  padding: 7px 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,.14);
  background: rgba(255,255,255,.10); color: inherit; cursor: pointer; font: inherit;
}
.vt-btn:hover { background: rgba(255,255,255,.18); }
.vt-btn[disabled] { opacity: .5; cursor: default; }
.vt-toolbar { display: flex; gap: 6px; padding: 6px 8px; align-items: center; border-bottom: 1px solid rgba(255,255,255,.08); }
.vt-toolbar .vt-btn { padding: 4px 9px; font-size: 12px; }
.vt-card {
  margin: 14px; padding: 14px; border-radius: 12px; background: rgba(255,255,255,.05);
  border: 1px solid rgba(255,255,255,.10); display: flex; flex-direction: column; gap: 10px;
}
.vt-card p { margin: 0; color: #c6c6d0; white-space: pre-wrap; }
.vt-card a { color: #8ab8ff; }
.vt-err { color: #ff9c9c; white-space: pre-wrap; }
`;

// 마스코트 오버레이 전용(라이트 DOM — document.body 직결이라 격리된 최소 셀렉터만).
export const MASCOT_CSS = `
#soksak-vtuber-mascot {
  position: fixed; right: 16px; bottom: 12px; width: 280px; height: 380px;
  z-index: 2147483000; pointer-events: none;
}
#soksak-vtuber-mascot .vtm-stage { position: absolute; inset: 0 0 34px 0; }
#soksak-vtuber-mascot .vtm-stage canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
#soksak-vtuber-mascot .vtm-subtitle {
  position: absolute; left: 0; right: 0; bottom: 0; min-height: 20px; max-height: 64px; overflow: hidden;
  text-align: center; font: 13px/1.4 system-ui, sans-serif; color: #fff;
  background: rgba(20,16,24,.72); border-radius: 10px; padding: 5px 9px; white-space: pre-wrap;
}
#soksak-vtuber-mascot .vtm-subtitle:empty { display: none; }
`;

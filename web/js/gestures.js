// On the home screen there is no browser chrome, so the app does its own
// edge-swipe back and pull to refresh. In Safari the browser already does both.
import { el, time } from "./dom.js";
import { t } from "./i18n.js";

export function initGestures({ app, atHome, back, refresh }) {
  const ptr = el("div", { id: "ptr" }, t("ptrPull"));
  document.body.append(ptr);
  let swipe = null, pull = null;
  addEventListener("touchstart", (e) => {
    const touch = e.touches[0];
    if (!atHome() && touch.clientX < 24) swipe = { x: touch.clientX, y: touch.clientY, dx: 0 };
    else if (scrollY <= 0) pull = { y: touch.clientY, d: 0 };
  }, { passive: true });
  addEventListener("touchmove", (e) => {
    const touch = e.touches[0];
    if (swipe) {
      swipe.dx = Math.max(0, touch.clientX - swipe.x);
      if (swipe.dx < 16 && Math.abs(touch.clientY - swipe.y) > 30) { swipe = null; app.style.transform = ""; return; }
      app.style.transition = "none";
      app.style.transform = `translateX(${swipe.dx}px)`;
    } else if (pull) {
      pull.d = Math.max(0, touch.clientY - pull.y);
      ptr.style.transition = "none";
      ptr.style.transform = `translate(-50%, ${Math.min(pull.d, 130) / 2 - 64}px)`;
      ptr.textContent = pull.d > 90 ? t("ptrRelease") : t("ptrPull");
    }
  }, { passive: true });
  addEventListener("touchend", () => {
    if (swipe) {
      const go = swipe.dx > 90;
      swipe = null;
      app.style.transition = "transform .28s cubic-bezier(.2,.8,.2,1)";
      app.style.transform = go ? "translateX(100%)" : "";
      if (go) setTimeout(() => { app.style.transition = "none"; app.style.transform = ""; back({ animate: false }); }, 260);
    } else if (pull) {
      const go = pull.d > 90;
      pull = null;
      ptr.style.transition = "";
      if (!go) { ptr.style.transform = ""; return; }
      ptr.textContent = t("ptrLoading");
      ptr.style.transform = "translate(-50%, 0)";
      refresh().then((ok) => {
        ptr.textContent = ok ? t("ptrDone", { time: time(Date.now()) }) : t("ptrFail");
        setTimeout(() => (ptr.style.transform = ""), 900);
      });
    }
  });
}

// What the device can do about push. iPhone and iPad only get web push in a
// web app opened from the home screen, so Safari there is told to add it first.

export function pushState({ ua, touch = false, standalone, hasPush, permission }) {
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && touch);
  if (ios && !standalone) return "add-to-home";
  if (!hasPush) return "unsupported";
  if (permission === "denied") return "denied";
  return "ready";
}

export function currentDevice() {
  return {
    ua: navigator.userAgent,
    touch: navigator.maxTouchPoints > 1,
    standalone: matchMedia("(display-mode: standalone)").matches || navigator.standalone === true,
    hasPush: "serviceWorker" in navigator && "PushManager" in window && "Notification" in window,
    permission: "Notification" in window ? Notification.permission : "default",
  };
}

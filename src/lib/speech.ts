// Web Speech API helper — quality and availability vary by browser/device.
export function speechSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

function pickVoice(langCode: string): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis.getVoices();
  return (
    voices.find((v) => v.lang === langCode) ??
    voices.find((v) => v.lang.replace("_", "-") === langCode) ??
    voices.find((v) => v.lang.startsWith(langCode.split("-")[0]))
  );
}

export function speak(text: string, langCode: string, rate = 0.95) {
  if (!speechSupported()) return;
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = langCode;
  utter.rate = rate;
  const voice = pickVoice(langCode);
  if (voice) utter.voice = voice;
  window.speechSynthesis.speak(utter);
}

export function stopSpeaking() {
  if (speechSupported()) window.speechSynthesis.cancel();
}

// Preload voices (Chrome loads them asynchronously).
export function warmVoices() {
  if (speechSupported()) window.speechSynthesis.getVoices();
}

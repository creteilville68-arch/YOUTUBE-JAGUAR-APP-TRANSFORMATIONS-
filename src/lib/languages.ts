export type Language = {
  code: string; // BCP 47 for speech synthesis
  value: string; // English name passed to the AI
  label: string; // Portuguese display label
  flag: string;
};

export const LANGUAGES: Language[] = [
  { code: "en-US", value: "English", label: "Inglês", flag: "🇺🇸" },
  { code: "es-ES", value: "Spanish", label: "Espanhol", flag: "🇪🇸" },
  { code: "fr-FR", value: "French", label: "Francês", flag: "🇫🇷" },
  { code: "de-DE", value: "German", label: "Alemão", flag: "🇩🇪" },
  { code: "it-IT", value: "Italian", label: "Italiano", flag: "🇮🇹" },
  { code: "ja-JP", value: "Japanese", label: "Japonês", flag: "🇯🇵" },
  { code: "ko-KR", value: "Korean", label: "Coreano", flag: "🇰🇷" },
  { code: "zh-CN", value: "Mandarin Chinese", label: "Chinês (Mandarim)", flag: "🇨🇳" },
  { code: "pt-BR", value: "Brazilian Portuguese", label: "Português (BR)", flag: "🇧🇷" },
  { code: "ru-RU", value: "Russian", label: "Russo", flag: "🇷🇺" },
];

export function findLanguage(value: string): Language | undefined {
  return LANGUAGES.find((l) => l.value === value);
}

export const CEFR_LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;
export type CefrLevel = (typeof CEFR_LEVELS)[number];

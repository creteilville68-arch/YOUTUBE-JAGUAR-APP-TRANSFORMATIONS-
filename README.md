# LínguaViva 🎬→📚

Transforme a transcrição de qualquer vídeo do YouTube em uma aula de idioma completa:
tradução frase por frase, vocabulário com múltiplos significados, leitura acompanhada
com áudio, exportação em PDF e flashcards com repetição espaçada (SM-2).

## Stack

- **Frontend:** React 18 + Vite + Tailwind CSS + Framer Motion
- **Backend:** Convex (banco de dados reativo + funções serverless)
- **Auth:** Convex Auth (e-mail/senha)
- **IA:** Google Gemini (`gemini-2.5-flash`) via camada gratuita — chamadas feitas
  no servidor Convex, a chave nunca vai para o navegador

## Rodando

```bash
bun install
bun convex dev --once   # codegen do backend
bun run dev             # app em 0.0.0.0
```

Variável de ambiente necessária (defina no painel do Freebuff ou no `.env.local`):

- `GEMINI_API_KEY` — chave gratuita de [aistudio.google.com](https://aistudio.google.com) (sem cartão)
- `VITE_CONVEX_URL` — definida automaticamente pelo Freebuff

## Fluxo da IA (5 tipos de chamada)

1. **Restauração de pontuação** — transcrições automáticas chegam sem pontuação; o texto
   é dividido em pedaços de ~320 palavras (pedaços já pontuados pulam a chamada).
2. **Geração do bloco de aula** — grupos de até 2 frases com tradução + 1–2 palavras de
   vocabulário (classe, significados, nota de contexto, 1 exemplo). JSON truncado é
   recuperado dividindo o bloco ao meio recursivamente.
3. **Resumo do vídeo** — 3–4 linhas no idioma nativo do usuário.
4. **Dicionário sob demanda** — toque em qualquer palavra da frase.
5. **Exemplos para flashcards** — quantidade 1–5, calibrados no nível CEFR escolhido.

## Limitações conhecidas

- **Importar transcrição direto da URL do YouTube não é possível no front-end puro:**
  os endpoints `timedtext` do YouTube não liberam CORS. O fluxo é copiar/colar
  ("…" → Mostrar transcrição → copiar). Um backend próprio com `youtube-transcript-api`
  resolveria, como projeto separado.
- Transcrições até ~2.400 palavras por aula (respeita o limite gratuito da IA).
- O áudio usa a Web Speech API do navegador — qualidade varia por dispositivo.

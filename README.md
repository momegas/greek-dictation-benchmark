# Greek dictation benchmark

Measures how well speech-to-text engines and small language models handle **Greek business
dictation** — invoices, tax acronyms, amounts, dates, and the English loanwords that Greek
office speech is full of. Everything runs through the [Vercel AI
Gateway](https://vercel.com/docs/ai-gateway), except ElevenLabs Scribe, which needs its own key.

The headline result is not about which model wins. It is that **figures are roughly twelve
times harder than prose for every engine tested**, which matters more for deciding where to
deploy dictation than the ranking does.

## Results

Round two: six shortlisted engines against 100 department passages (~10s each, 12 voices).
`CEER` is the share of must-get-right terms lost — ΦΠΑ, amounts, dates, names. It is the
ranking key rather than `WER`, because a mangled tax acronym is one token that makes an
invoice line useless, while two fumbled function words do not.

| Engine | CEER | on figures | on prose | WER | p50 |
|---|---|---|---|---|---|
| `openai/gpt-4o-transcribe` | **19.3%** | 36.3% | 2.9% | 8.8% | 1616ms |
| `openai/whisper-1` | **20.6%** | 32.9% | 8.8% | 14.7% | 2049ms |
| `openai/gpt-4o-mini-transcribe` | **23.3%** | 44.5% | 2.9% | 11.9% | 1145ms |
| `elevenlabs/scribe-v1` | **25.6%** | 51.3% | 1.0% | 13.8% | 3174ms |
| `fish-audio/transcribe-1` | **34.6%** | 46.0% | 23.5% | 22.8% | 1443ms |
| `spacexai/grok-stt` | **38.8%** | 56.8% | 21.6% | 32.0% | 1048ms |

Language models, cleaning up a transcript without changing it:

| Model | Cleanup WER | Digits preserved |
|---|---|---|
| `openai/gpt-5.6-luna` | 1.9% | 100% |
| `alibaba/qwen3.8-27b` | 4.4% | 100% |
| `alibaba/qwen3.7-flash` | 4.7% | 100% |
| `deepseek/deepseek-v4-flash-0731` | 5.1% | 100% |
| `spacexai/grok-4.1-fast-reasoning` | 5.3% | 100% |
| `alibaba/qwen-3-32b` | 6.5% | 100% |

`report.html` is the full write-up — eight chapters, each stating what was measured, how, and
what came back. Open it in a browser; it needs no server.

### What to take from this

- **Use `openai/gpt-4o-transcribe`**, or `gpt-4o-mini-transcribe` at half the price and
  4 points worse.
- **Dictation is production-ready for narrative work and needs review for anything with
  amounts in it.** Finance, accounting and procurement are the weakest departments for every
  engine; legal, technical and support the strongest. That tracks figure density, not subject.
- **A language-model cleanup pass is safe.** All six preserved every digit; the only rewrites
  added correct Greek thousands separators (35000 → 35.000).
- **Scribe is accurate but expensive and slow** — 4.4× the cost and ~2× the latency of the
  winner for no accuracy gain on this corpus.

## Setup

```bash
npm install
cp .env.example .env     # add AI_GATEWAY_API_KEY
```

`ELEVENLABS_API_KEY` is optional: without it the Scribe rows are skipped and everything else
runs. The scripts load `.env` themselves, so `npm run <stage>` is all you need.

`ffmpeg` must be on PATH — `ffprobe` measures each clip's exact duration, which is what
per-second pricing is billed against.

## Running it

```bash
npm run selftest        # verify the Greek normalizer and metrics FIRST
npm run judgetest       # judge reproducibility + rubric discrimination

npm run synth:depts     # build the 100-passage corpus (idempotent)
npm run r2:stt          # speech-to-text sweep
npm run r2:llm          # language models + judge
npm run report          # regenerate report.html
```

Round one, which produced the shortlist:

```bash
npm run synth && npm run stage1 && npm run stage1b && npm run stage2 && npm run stage3
```

Start with `selftest`. A normalizer bug is invisible — it makes every model look uniformly
better or worse — so nothing downstream means anything until it passes.

Every model response and judge verdict is cached by content hash. Re-running after a scoring
change costs nothing and returns identical numbers, which is what makes it cheap to fix a
metric and re-score rather than re-measure.

## How it works

```
src/
  corpus/
    utterances.ts     40 short utterances, 8 vocabulary categories  (round one)
    departments.ts    100 passages, 11 business functions           (round two)
    tasks.ts          11 reasoning tasks, incl. two hallucination traps
    synthesize.ts     round-one audio
    synth-depts.ts    round-two audio: routes by content, rotates 12 voices
  lib/
    normalize.ts      the Greek normalization ladder (L0–L4) + numeral folding
    metrics.ts        WER/CER alignment, entity scoring
    judge.ts          LLM-as-judge, fixed rubric, versioned
    pricing.ts        four billing shapes; never estimates a missing price
    stt-providers.ts  gateway engines + the direct ElevenLabs adapter
    runner.ts         bounded concurrency, non-fatal failures
    cache.ts          content-addressed response cache
    gateway.ts        live model catalog; loads .env
    html.ts           the report's design system, charts and diagrams
  shortlist.ts        who advanced from round one, and why the rest did not
```

### Measurement decisions worth knowing

**Greek normalization is a ladder, not one function.** Final sigma (ς/σ) and NFC/NFD
differences are provider noise rather than transcription errors, so they are folded at L1 and
always applied. Punctuation, accents and number formatting are separated into L2–L4 so a
report can show *why* a model lost, not just that it did. Accents are stripped by NFD
decomposition rather than a character map, because providers emit both forms.

**Entity accuracy is the ranking key.** Plain WER ranks a mangled «ΦΠΑ» below two fumbled
function words. Each utterance carries hand-labelled critical terms with accepted orthographic
variants, scored by presence rather than position, so rewording around a term is not punished.

**Spoken numbers are not errors.** "δεκαέξι κόμμα ενενήντα εννιά" and "16,99" are the same
answer. Greek number words are folded to digits on both sides before comparison, including
compounds like «ογδοντατέσσερις» (84).

**TTS is routed by content, and this was measured.** `openai/tts-1` speaks good Greek prose —
four independent engines agree on its output — but garbles figures: 4471 comes back as 473,
1.250,00 as 2,50. Four engines failing identically points at the audio, not the transcribers.
So figure-bearing passages go to `spacexai/grok-tts` (6 voices) and prose to `openai/tts-1`
(6 voices). Do not judge a TTS voice by transcribing it with one engine — that is circular.

**Ground truth is verified, not assumed.** Every clip is re-transcribed and compared to its
own reference before use, so a mispronunciation cannot silently become the thing engines are
graded against. Two passages that came back as non-Greek audio were caught this way.

**The judge is reported beside deterministic checks, never instead of them.**
`gpt-5.6-terra` at temperature 0 against a rubric versioned into the cache key. It is
reproducible — identical verdicts across three runs — but it is lenient, by up to 35 points on
the weakest model, because it rewards fluent Greek it cannot verify. Where the two disagree,
the deterministic checks are right.

**A missing price is reported as unknown, never estimated.** Both `fish-audio` models publish
no pricing, and a fabricated number would have won them the cost ranking.

## Limits

The corpus is **TTS-synthesized clean speech**: one voice per clip, no disfluencies, no mic
compression, no room noise, no accent variation.

1. **These are floor numbers.** Real-world error rates will be higher.
2. **It over-ranks engines that are brittle to noise.** An engine can win here and collapse on
   a real phone mic.
3. **It under-measures the cleanup stage**, whose real job is repairing noise-induced garbage.
   On clean input there is less to repair.

Latency is from one machine on one network — directional, not an SLA. Adding
ffmpeg-degraded variants, or a small human-recorded set, is the natural next step.

## Licence

MIT.

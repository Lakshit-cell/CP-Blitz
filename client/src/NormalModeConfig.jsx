import { useMemo, useState } from "react";

const NORMAL_LIMITS = {
  questions: { min: 1, max: 20 },
  minutes: { min: 5, max: 180 },
  rating: { min: 800, max: 3500 },
};

const DEFAULT_CONFIG = {
  questionCount: 6,
  minRating: 800,
  maxRating: 1200,
  durationMinutes: 30,
};

function parseInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

export default function NormalModeConfig({ onStart, onCancel, defaultHandle = "" }) {
  const [handle, setHandle] = useState(defaultHandle);
  const [questionCount, setQuestionCount] = useState(String(DEFAULT_CONFIG.questionCount));
  const [minRating, setMinRating] = useState(String(DEFAULT_CONFIG.minRating));
  const [maxRating, setMaxRating] = useState(String(DEFAULT_CONFIG.maxRating));
  const [durationMinutes, setDurationMinutes] = useState(String(DEFAULT_CONFIG.durationMinutes));

  const validation = useMemo(() => {
    const next = {
      handle: "",
      questionCount: "",
      minRating: "",
      maxRating: "",
      ratingRange: "",
      durationMinutes: "",
    };

    if (!handle.trim()) next.handle = "Enter your Codeforces handle.";

    const questionValue = parseInteger(questionCount);
    if (!questionValue || questionValue < NORMAL_LIMITS.questions.min || questionValue > NORMAL_LIMITS.questions.max) {
      next.questionCount = `Choose between ${NORMAL_LIMITS.questions.min}–${NORMAL_LIMITS.questions.max} questions.`;
    }

    const minValue = parseInteger(minRating);
    const maxValue = parseInteger(maxRating);
    if (!minValue || minValue < NORMAL_LIMITS.rating.min || minValue > NORMAL_LIMITS.rating.max) {
      next.minRating = `Minimum rating must be between ${NORMAL_LIMITS.rating.min}–${NORMAL_LIMITS.rating.max}.`;
    }
    if (!maxValue || maxValue < NORMAL_LIMITS.rating.min || maxValue > NORMAL_LIMITS.rating.max) {
      next.maxRating = `Maximum rating must be between ${NORMAL_LIMITS.rating.min}–${NORMAL_LIMITS.rating.max}.`;
    }
    if (!next.minRating && !next.maxRating && minValue > maxValue) {
      next.ratingRange = "Minimum rating cannot exceed maximum rating.";
    }

    const durationValue = parseInteger(durationMinutes);
    if (!durationValue || durationValue < NORMAL_LIMITS.minutes.min || durationValue > NORMAL_LIMITS.minutes.max) {
      next.durationMinutes = `Time must be between ${NORMAL_LIMITS.minutes.min}–${NORMAL_LIMITS.minutes.max} minutes.`;
    }

    const isValid = Object.values(next).every((value) => !value);

    return {
      errors: next,
      isValid,
      values: {
        handle: handle.trim(),
        questionCount: questionValue,
        minRating: minValue,
        maxRating: maxValue,
        durationMinutes: durationValue,
      },
    };
  }, [handle, questionCount, minRating, maxRating, durationMinutes]);

  const start = () => {
    if (!validation.isValid) return;
    onStart(validation.values);
  };

  return (
    <div className="w-full max-w-4xl">
      <div className="rounded-3xl p-7 arcade-panel">
        <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <div className="text-sm text-slate-400">Mode</div>
            <div className="mt-1 text-2xl font-extrabold text-slate-50 arcade-title">Normal Mode</div>
            <div className="mt-2 text-sm text-slate-300">
              Configure a custom solo practice session with a fixed timer and rating range.
            </div>
          </div>
          <button
            onClick={onCancel}
            className="rounded-2xl bg-rose-400/10 px-4 py-2 text-sm font-semibold text-rose-100 ring-1 ring-rose-400/30 hover:bg-rose-400/15"
          >
            Back
          </button>
        </div>

        <div className="mt-6 grid gap-5 md:grid-cols-2">
          <div>
            <div className="text-sm font-semibold text-slate-200">Codeforces handle</div>
            <input
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              placeholder="e.g. tourist"
              className="mt-2 w-full rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-slate-100 shadow-sm outline-none placeholder:text-slate-400 focus:border-cyan-400/40 focus:ring-4 focus:ring-cyan-400/10"
            />
            {validation.errors.handle && <div className="mt-2 text-xs text-rose-200">{validation.errors.handle}</div>}
          </div>

          <div>
            <div className="text-sm font-semibold text-slate-200">Number of questions</div>
            <input
              type="number"
              min={NORMAL_LIMITS.questions.min}
              max={NORMAL_LIMITS.questions.max}
              value={questionCount}
              onChange={(e) => setQuestionCount(e.target.value)}
              className="mt-2 w-full rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-slate-100 shadow-sm outline-none focus:border-cyan-400/40 focus:ring-4 focus:ring-cyan-400/10"
            />
            {validation.errors.questionCount && (
              <div className="mt-2 text-xs text-rose-200">{validation.errors.questionCount}</div>
            )}
          </div>
        </div>

        <div className="mt-6">
          <div className="text-sm font-semibold text-slate-200">Rating range</div>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <div>
              <input
                type="number"
                min={NORMAL_LIMITS.rating.min}
                max={NORMAL_LIMITS.rating.max}
                step={100}
                value={minRating}
                onChange={(e) => setMinRating(e.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-slate-100 shadow-sm outline-none focus:border-cyan-400/40 focus:ring-4 focus:ring-cyan-400/10"
                placeholder="Min rating"
              />
              {validation.errors.minRating && <div className="mt-2 text-xs text-rose-200">{validation.errors.minRating}</div>}
            </div>
            <div>
              <input
                type="number"
                min={NORMAL_LIMITS.rating.min}
                max={NORMAL_LIMITS.rating.max}
                step={100}
                value={maxRating}
                onChange={(e) => setMaxRating(e.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-slate-100 shadow-sm outline-none focus:border-cyan-400/40 focus:ring-4 focus:ring-cyan-400/10"
                placeholder="Max rating"
              />
              {validation.errors.maxRating && <div className="mt-2 text-xs text-rose-200">{validation.errors.maxRating}</div>}
            </div>
          </div>
          {validation.errors.ratingRange && <div className="mt-2 text-xs text-rose-200">{validation.errors.ratingRange}</div>}
        </div>

        <div className="mt-6">
          <div className="text-sm font-semibold text-slate-200">Total time (minutes)</div>
          <input
            type="number"
            min={NORMAL_LIMITS.minutes.min}
            max={NORMAL_LIMITS.minutes.max}
            value={durationMinutes}
            onChange={(e) => setDurationMinutes(e.target.value)}
            className="mt-2 w-full rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-slate-100 shadow-sm outline-none focus:border-cyan-400/40 focus:ring-4 focus:ring-cyan-400/10"
          />
          {validation.errors.durationMinutes && (
            <div className="mt-2 text-xs text-rose-200">{validation.errors.durationMinutes}</div>
          )}
        </div>

        <div className="mt-8 flex flex-wrap items-center gap-3">
          <button
            onClick={start}
            disabled={!validation.isValid}
            className="rounded-2xl bg-cyan-400/15 px-5 py-3 text-sm font-semibold text-cyan-100 shadow-sm ring-1 ring-cyan-400/30 hover:bg-cyan-400/20 disabled:cursor-not-allowed disabled:opacity-50 arcade-glow"
          >
            Start Normal Mode
          </button>
          <div className="text-xs text-slate-400">
            Problems will be pulled immediately and the timer starts as soon as the session loads.
          </div>
        </div>
      </div>
    </div>
  );
}

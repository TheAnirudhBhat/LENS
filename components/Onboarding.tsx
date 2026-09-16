"use client";

import { useEffect, useLayoutEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui";

// First-run welcome for LENS (spec §6.5). Opens on a calm financial quote that
// fades in; on Continue it moves into three image slides (split layout: a warm
// golden-hour image on the left, one idea on the right). On the final CTA the
// whole screen dissolves from the bottom, revealing the dashboard. Detailed
// how-it-works and strategy live in the "?" panel. Seen-flag is persisted to
// ui_state.json via /api/ui-state.
// Force-open: ?onboarding=1 or the "lens:open-onboarding" event.
const EXIT_MS = 720;

// One image per slide — a cohesive warm golden-hour set, broad → close → calm.
const IMAGES = ["/onboarding-1.jpg", "/onboarding-2.jpg", "/onboarding-3.jpg"];

// useLayoutEffect on the client (runs before paint, so the white overlay covers
// the dashboard with no flash); useEffect on the server to avoid the SSR warning.
const useIsoLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

function Cmd({ children }: { children: ReactNode }) {
  return (
    <code
      className="mono-true inline-flex items-center rounded-md px-2 py-0.5 text-[14px] text-primary"
      style={{ background: "var(--bg-subtle)", border: "1px solid var(--border)" }}
    >
      {children}
    </code>
  );
}

// The AI assistants LENS runs through, shown as their official logos.
function AssistantLogos() {
  const items = [
    { src: "/logos/claude-color.png", label: "Claude" },
    { src: "/logos/openai.png", label: "Codex" },
    { src: "/logos/gemini-color.png", label: "Gemini" },
  ];
  return (
    <div className="flex items-center gap-6">
      {items.map((it) => (
        <div key={it.label} className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={it.src} alt={it.label} className="w-7 h-7 object-contain" />
          <span className="text-[14px] text-secondary">{it.label}</span>
        </div>
      ))}
    </div>
  );
}

// Prominent command pill — highlights the one command that matters.
function RefreshCallout() {
  return (
    <div
      className="inline-flex items-center gap-3 rounded-lg px-4 py-2.5"
      style={{ background: "var(--bg-subtle)", border: "1px solid var(--border)" }}
    >
      <code className="mono-true text-[16px] font-medium" style={{ color: "var(--brand)" }}>
        /portfolio-check
      </code>
      <span className="text-[13px] text-tertiary">run anytime to refresh</span>
    </div>
  );
}

type Page = { title: string; lead: ReactNode; media?: ReactNode; body?: ReactNode };

const PAGES: Page[] = [
  {
    title: "This is LENS",
    lead: (
      <>Every investment you hold, and the thinking behind every move, in one place.</>
    ),
  },
  {
    title: "You just talk to it",
    lead: <>LENS runs through your AI assistant.</>,
    media: <AssistantLogos />,
    body: <>Ask anything in plain English. It does the rest.</>,
  },
  {
    title: "Keep it safe and current",
    lead: (
      <>
        Keep your LENS folder in{" "}
        <strong className="text-primary font-medium">Documents</strong>, not
        Downloads. It holds everything.
      </>
    ),
    media: <RefreshCallout />,
  },
];

// The text column for one slide: title, lead, optional media, optional body.
// Rendered both as invisible height "ghosts" (every slide) and as the visible
// active slide, so the layout always reserves the tallest slide's height and the
// CTA below it never shifts between slides.
function SlideBody({ p }: { p: Page }) {
  return (
    <>
      <h1 className="text-[34px] md:text-[46px] font-semibold tracking-[-0.02em] text-primary leading-[1.04]">
        {p.title}
      </h1>
      <p className="mt-6 text-[19px] md:text-[22px] text-secondary leading-[1.45]">
        {p.lead}
      </p>
      {p.media && <div className="mt-6">{p.media}</div>}
      {p.body && (
        <p className="mt-5 text-[15px] md:text-[16px] text-tertiary leading-relaxed">
          {p.body}
        </p>
      )}
    </>
  );
}

export function Onboarding() {
  const [open, setOpen] = useState(false);
  const [intro, setIntro] = useState(true);
  const [leaving, setLeaving] = useState(false);
  const [page, setPage] = useState(0);
  const [prevPage, setPrevPage] = useState(0);
  const [exiting, setExiting] = useState(false);

  // Forced (?onboarding=1): open before the first paint so the dashboard never
  // flashes behind the overlay. Initial state stays false (matches SSR); this
  // flips it synchronously on the client, before paint.
  useIsoLayoutEffect(() => {
    if (new URLSearchParams(window.location.search).get("onboarding") === "1") {
      setOpen(true);
      // The pre-hydration white cover (layout.tsx) has done its job — the overlay
      // takes over now, before paint.
      document.getElementById("onb-preboot")?.remove();
    }
  }, []);

  // Warm the image cache so the per-slide crossfade never waits on a decode.
  useEffect(() => {
    IMAGES.forEach((src) => {
      const img = new window.Image();
      img.src = src;
    });
  }, []);

  useEffect(() => {
    const forced =
      new URLSearchParams(window.location.search).get("onboarding") === "1";
    if (!forced) {
      fetch("/api/ui-state")
        .then((r) => r.json())
        .then((s) => { if (!s?.onboardingSeenAt) setOpen(true); })
        .catch(() => {});
    }

    const reopen = () => {
      setExiting(false);
      setLeaving(false);
      setIntro(true);
      setPrevPage(0);
      setPage(0);
      setOpen(true);
    };
    window.addEventListener("lens:open-onboarding", reopen);
    return () => window.removeEventListener("lens:open-onboarding", reopen);
  }, []);

  function finish() {
    fetch("/api/ui-state", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ onboardingSeenAt: new Date().toISOString() }),
    }).catch(() => {});
    // After the reveal, strip ?onboarding=1 from the URL (no reload) so a refresh
    // doesn't re-force the overlay.
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.has("onboarding")) {
        url.searchParams.delete("onboarding");
        window.history.replaceState(null, "", url.pathname + url.search + url.hash);
      }
    } catch {
      /* ignore */
    }
    setExiting(false);
    setOpen(false);
  }

  function dismiss() {
    if (exiting) return;
    setExiting(true);
    window.setTimeout(finish, EXIT_MS);
  }

  // Quote → slides: fade the quote out, then reveal the first image slide.
  function begin() {
    if (leaving) return;
    setLeaving(true);
    window.setTimeout(() => {
      setLeaving(false);
      setIntro(false);
    }, 340);
  }

  // Remember where we came from so the incoming image can fade in over the
  // outgoing one (which stays fully opaque underneath) — no crossfade dip.
  function goTo(n: number) {
    setPrevPage(page);
    setPage(n);
  }

  // Escape intentionally does NOT dismiss — the user must complete the onboarding
  // via the final CTA. (No keydown handler, no close button.)

  if (!open) return null;
  if (typeof document === "undefined") return null;

  const p = PAGES[page];
  const last = page === PAGES.length - 1;

  return createPortal(
    <div
      className={`onboarding-screen fixed inset-0 z-[60] overflow-hidden ${
        exiting ? "onboarding-exit pointer-events-none" : ""
      }`}
      role="dialog"
      aria-modal="true"
      aria-label="Welcome to LENS"
      style={{ background: "var(--bg-base)" }}
    >
      <style>{`
        /* Final CTA: the screen dissolves from the bottom, revealing the dashboard. */
        .onboarding-exit {
          -webkit-mask-image: linear-gradient(to bottom, #000 0%, #000 40%, transparent 62%, transparent 100%);
          mask-image: linear-gradient(to bottom, #000 0%, #000 40%, transparent 62%, transparent 100%);
          -webkit-mask-size: 100% 300%; mask-size: 100% 300%;
          -webkit-mask-repeat: no-repeat; mask-repeat: no-repeat;
          will-change: -webkit-mask-position, mask-position;
          animation: lensOnbReveal ${EXIT_MS}ms cubic-bezier(0.65, 0, 0.35, 1) forwards;
        }
        @keyframes lensOnbReveal {
          from { -webkit-mask-position: 0% 0%;   mask-position: 0% 0%; }
          to   { -webkit-mask-position: 0% 100%; mask-position: 0% 100%; }
        }
        /* Opening quote fades in slowly; the Continue button follows. */
        .onb-quote-screen { transition: opacity 300ms ease; }
        .onb-quote-leaving { opacity: 0; }
        .onb-quote { animation: onbQuote 1100ms cubic-bezier(0.22, 1, 0.36, 1) both; }
        /* Continue appears well after the quote settles — a slow, pure-opacity fade. */
        .onb-quote-cta { animation: onbCtaIn 1200ms ease 1500ms both; }
        @keyframes onbQuote {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes onbCtaIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        /* Each slide's image fades in over the opaque previous one — kills the dip.
           Opacity + transform only (no blur) so the GPU composites it at 60fps. */
        .onb-img {
          will-change: opacity, transform;
          animation: onbImgIn 600ms cubic-bezier(0.22, 1, 0.36, 1) both;
        }
        @keyframes onbImgIn {
          from { opacity: 0; transform: scale(1.04); }
          to   { opacity: 1; transform: scale(1); }
        }
        /* First reveal from the quote: the panel slides in from the left.
           Transform only (no opacity) so the faded right edge stays solid
           through the slide and never seams against the content panel. The image
           itself still fades/scales in via .onb-img below, so it still materializes. */
        .onb-enter-img {
          will-change: transform;
          animation: onbEnterImg 660ms cubic-bezier(0.22, 1, 0.36, 1) both;
        }
        @keyframes onbEnterImg {
          from { transform: translateX(-52px); }
          to   { transform: translateX(0); }
        }
        /* Copy eases in with a gentle stagger: title → lead → note. */
        .onb-fade > * {
          will-change: opacity, transform;
          animation: onbFade 500ms cubic-bezier(0.22, 1, 0.36, 1) both;
        }
        .onb-fade > *:nth-child(2) { animation-delay: 70ms; }
        .onb-fade > *:nth-child(3) { animation-delay: 140ms; }
        .onb-fade > *:nth-child(4) { animation-delay: 210ms; }
        @keyframes onbFade {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @media (prefers-reduced-motion: reduce) {
          .onb-img, .onb-enter-img, .onb-fade > *, .onb-quote, .onb-quote-cta { animation: none; }
          .onb-quote-screen { transition: none; }
          .onboarding-exit {
            animation: none;
            -webkit-mask-image: none; mask-image: none;
            opacity: 0; transition: opacity 200ms ease;
          }
        }
      `}</style>

      {/* No skip/close button — the onboarding is completed via the final CTA. */}

      {intro && (
        <div
          className={`onb-quote-screen absolute inset-0 z-10 flex flex-col items-center justify-center text-center px-8 ${
            leaving ? "onb-quote-leaving" : ""
          }`}
          style={{ background: "var(--bg-base)" }}
        >
          <div className="onb-quote w-full max-w-2xl">
            <p className="font-serif italic text-[26px] md:text-[34px] text-primary leading-[1.42]">
              &ldquo;The stock market is a device for transferring money from the
              impatient to the patient.&rdquo;
            </p>
            <p className="mt-7 text-[12px] md:text-[13px] tracking-[0.16em] uppercase text-tertiary">
              Warren Buffett
            </p>
          </div>
          <div className="onb-quote-cta mt-14">
            <Button
              variant="primary"
              onClick={begin}
              className="px-6 py-2.5 text-[14px]"
            >
              Continue
            </Button>
          </div>
        </div>
      )}

      {(!intro || leaving) && (
        <div className="flex h-full w-full" style={{ background: "var(--bg-base)" }}>
          {/* Left: one image per slide. A static, fully opaque "base" (the
              previous image) sits under the incoming "top" image, so the
              focus-in never dips to the background behind the overlay. */}
          <div
            className="onb-enter-img hidden md:block md:w-1/2 relative overflow-hidden"
            style={{
              background: "var(--bg-base)",
              // Fade the whole panel (image + bg) to transparent on its right edge,
              // dissolving into the content panel beside it. A mask on the panel
              // itself cannot seam (unlike a separate white overlay), and it rides
              // along with the slide-in transform + the image's scale/opacity.
              WebkitMaskImage:
                "linear-gradient(to right, #000 55%, transparent 92%)",
              maskImage: "linear-gradient(to right, #000 55%, transparent 92%)",
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              key={`onb-base-${prevPage}`}
              src={IMAGES[prevPage]}
              alt=""
              aria-hidden="true"
              className="absolute object-cover"
              style={{ top: -1, left: -1, right: -1, bottom: -1, backfaceVisibility: "hidden" }}
            />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              key={`onb-top-${page}`}
              src={IMAGES[page]}
              alt=""
              aria-hidden="true"
              className="onb-img absolute object-cover"
              style={{ top: -1, left: -1, right: -1, bottom: -1, backfaceVisibility: "hidden" }}
            />
          </div>

          {/* Right: content */}
          <div
            className="relative w-full md:w-1/2 flex flex-col"
            style={{ background: "var(--bg-base)" }}
          >
            <div className="flex-1 flex flex-col justify-center px-10 md:px-20 py-14">
              <div className="w-full max-w-lg">
                {/* All slides are stacked in one grid cell: invisible "ghosts" size
                    the area to the tallest slide so the CTA stays fixed between
                    slides, while the active slide (re-keyed) fades in on top. */}
                <div className="grid items-start">
                  {PAGES.map((pg, i) => (
                    <div
                      key={`ghost-${i}`}
                      aria-hidden
                      className="invisible col-start-1 row-start-1"
                    >
                      <SlideBody p={pg} />
                    </div>
                  ))}
                  <div key={page} className="onb-fade col-start-1 row-start-1">
                    <SlideBody p={p} />
                  </div>
                </div>

                <div className="mt-12 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-5">
                    {page > 0 && (
                      <Button
                        variant="ghost"
                        onClick={() => goTo(page - 1)}
                        className="px-0"
                      >
                        Back
                      </Button>
                    )}
                  </div>

                  <Button
                    variant="primary"
                    onClick={() => (last ? dismiss() : goTo(page + 1))}
                    className="px-6 py-2.5 text-[14px]"
                  >
                    {last ? "Let's go" : "Next"}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body
  );
}

export default Onboarding;

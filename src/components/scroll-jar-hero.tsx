"use client";

import Image from "next/image";
import { ArrowDown, ArrowRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";

const clamp = (value: number, min = 0, max = 1) =>
  Math.min(max, Math.max(min, value));

const segment = (progress: number, start: number, end: number) =>
  clamp((progress - start) / (end - start));

const ease = (value: number) =>
  value < 0.5
    ? 2 * value * value
    : 1 - Math.pow(-2 * value + 2, 2) / 2;

export default function ScrollJarHero() {
  const sectionRef = useRef<HTMLElement>(null);
  const [progress, setProgress] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncPreference = () => setReducedMotion(media.matches);
    syncPreference();
    media.addEventListener("change", syncPreference);

    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const section = sectionRef.current;
        if (!section) return;

        const rect = section.getBoundingClientRect();
        const scrollable = section.offsetHeight - window.innerHeight;
        setProgress(clamp(-rect.top / Math.max(scrollable, 1)));
      });
    };

    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);

    return () => {
      cancelAnimationFrame(frame);
      media.removeEventListener("change", syncPreference);
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  const intro = ease(segment(progress, 0, 0.18));
  const flip = reducedMotion ? 0 : ease(segment(progress, 0.16, 0.58));
  const landing = ease(segment(progress, 0.58, 0.78));
  const finale = ease(segment(progress, 0.76, 1));

  const rotateZ = reducedMotion ? 0 : flip * 360;
  const rotateY = reducedMotion ? 0 : Math.sin(flip * Math.PI) * 13;
  const lift = reducedMotion
    ? 0
    : Math.sin(flip * Math.PI) * -110 + landing * 46;
  const horizontal = reducedMotion
    ? 0
    : Math.sin(progress * Math.PI * 2) * 42 * (1 - finale);
  const scale = 0.84 + intro * 0.15 + finale * 0.12;
  const shadowScale = 1 - Math.sin(flip * Math.PI) * 0.35;
  const shadowOpacity = 0.26 - Math.sin(flip * Math.PI) * 0.15;

  const firstOpacity = 1 - ease(segment(progress, 0.12, 0.3));
  const secondOpacity =
    ease(segment(progress, 0.22, 0.38)) *
    (1 - ease(segment(progress, 0.52, 0.68)));
  const thirdOpacity = ease(segment(progress, 0.68, 0.84));

  return (
    <section
      ref={sectionRef}
      className="scroll-jar-hero relative h-[390vh] bg-[#641916] text-[#f8efe2]"
      aria-label="Chef Ammar Kabsah Paste product story"
    >
      <div className="sticky top-0 h-screen overflow-hidden">
        <div
          className="absolute inset-0 transition-colors duration-300"
          style={{
            background: `radial-gradient(circle at 50% 44%, rgba(221,163,83,${
              0.16 + progress * 0.16
            }), transparent 28%), linear-gradient(145deg, #3c0b0b 0%, #6f1815 46%, #27100d 100%)`,
          }}
        />

        <div className="absolute inset-0 opacity-[0.12] scroll-jar-pattern" />
        <div className="absolute inset-x-0 top-0 z-20 h-28 bg-gradient-to-b from-black/25 to-transparent" />

        <div className="absolute left-5 top-6 z-30 text-xs font-semibold uppercase tracking-[0.24em] sm:left-10 sm:top-9">
          Chef Ammar
        </div>
        <div className="absolute right-5 top-6 z-30 text-[10px] uppercase tracking-[0.2em] text-white/60 sm:right-10 sm:top-9">
          Scroll to explore
        </div>

        <div
          className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center"
          style={{ perspective: "1400px" }}
        >
          <div
            className="relative h-[64vh] w-[min(72vw,520px)] will-change-transform sm:h-[72vh] sm:w-[min(54vw,560px)]"
            style={{
              transform: `translate3d(${horizontal}px, ${lift}px, 0) rotateY(${rotateY}deg) rotateZ(${rotateZ}deg) scale(${scale})`,
              transformStyle: "preserve-3d",
            }}
          >
            <div className="absolute inset-0 rounded-[44%] bg-[#f3b256]/15 blur-[54px]" />
            <Image
              src="/products/kabsah.svg"
              alt="Chef Ammar Kabsah Paste jar"
              fill
              priority
              sizes="(max-width: 640px) 72vw, 560px"
              className="relative z-10 object-contain drop-shadow-[0_34px_34px_rgba(0,0,0,0.34)]"
            />
          </div>
        </div>

        <div
          className="absolute bottom-[13vh] left-1/2 z-[5] h-9 w-52 -translate-x-1/2 rounded-[50%] bg-black blur-xl will-change-transform"
          style={{
            opacity: shadowOpacity,
            transform: `translateX(-50%) scale(${shadowScale})`,
          }}
        />

        <div className="pointer-events-none absolute inset-0 z-20">
          <div
            className="absolute inset-x-5 top-[15vh] mx-auto max-w-6xl text-center transition-opacity sm:top-[17vh]"
            style={{ opacity: firstOpacity }}
          >
            <p className="mb-4 text-[10px] font-semibold uppercase tracking-[0.3em] text-[#e6ad63] sm:text-xs">
              Rempah ratus asli Timur Tengah
            </p>
            <h1 className="font-serif text-[clamp(3.1rem,8vw,7.8rem)] leading-[0.85] tracking-[-0.055em]">
              Masak dari hati.
            </h1>
            <p className="mx-auto mt-5 max-w-md text-sm leading-6 text-white/65 sm:text-base">
              Satu pes lengkap untuk rasa Kabsah yang kaya, harum dan mudah disediakan.
            </p>
          </div>

          <div
            className="absolute left-6 top-[19vh] max-w-[17rem] sm:left-12 sm:top-[26vh] sm:max-w-sm"
            style={{ opacity: secondOpacity }}
          >
            <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-[#e6ad63] sm:text-xs">
              One controlled flip
            </p>
            <h2 className="mt-3 font-serif text-4xl leading-[0.95] tracking-[-0.04em] sm:text-6xl">
              Proper flavour. Less preparation.
            </h2>
            <p className="mt-5 text-sm leading-6 text-white/65 sm:max-w-xs sm:text-base">
              Scroll movement controls the jar directly, creating a cinematic product moment without autoplay video.
            </p>
          </div>

          <div
            className="absolute inset-x-6 bottom-[12vh] mx-auto max-w-xl text-center"
            style={{ opacity: thirdOpacity }}
          >
            <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-[#e6ad63] sm:text-xs">
              Kabsah Paste · 350g
            </p>
            <h2 className="mt-3 font-serif text-[clamp(2.8rem,7vw,6rem)] leading-[0.9] tracking-[-0.05em]">
              Rasa Timur Tengah, semudah satu pes.
            </h2>
            <div className="pointer-events-auto mt-7 flex flex-wrap items-center justify-center gap-4">
              <button
                type="button"
                onClick={() =>
                  document
                    .getElementById("collection")
                    ?.scrollIntoView({ behavior: "smooth" })
                }
                className="inline-flex h-12 items-center gap-2 rounded-full bg-[#f6ead8] px-6 text-sm font-semibold text-[#35110d] transition-transform hover:scale-[1.02]"
              >
                Shop Kabsah <ArrowRight className="size-4" />
              </button>
              <span className="text-sm text-white/65">RM19.90</span>
            </div>
          </div>
        </div>

        <div
          className="absolute bottom-7 left-1/2 z-30 flex -translate-x-1/2 flex-col items-center gap-2 text-[10px] uppercase tracking-[0.22em] text-white/55 transition-opacity"
          style={{ opacity: 1 - segment(progress, 0.08, 0.22) }}
        >
          Scroll
          <ArrowDown className="size-4 animate-bounce" />
        </div>

        <div className="absolute bottom-0 left-0 z-30 h-1 bg-white/10 right-0">
          <div
            className="h-full bg-[#e6ad63]"
            style={{ width: `${progress * 100}%` }}
          />
        </div>
      </div>
    </section>
  );
}

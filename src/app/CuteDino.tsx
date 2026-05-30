"use client";

import { useRef } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";

gsap.registerPlugin(useGSAP);

export default function CuteDino() {
  const root = useRef<SVGSVGElement>(null);

  useGSAP(
    () => {
      // Gentle idle bob for the whole dino
      gsap.to(".dino-body", {
        y: -10,
        duration: 1.4,
        ease: "sine.inOut",
        yoyo: true,
        repeat: -1,
      });

      // Tail wag
      gsap.fromTo(
        ".dino-tail",
        { rotation: -6, transformOrigin: "left center" },
        {
          rotation: 6,
          duration: 0.9,
          ease: "sine.inOut",
          yoyo: true,
          repeat: -1,
        }
      );

      // Little arm wave
      gsap.fromTo(
        ".dino-arm",
        { rotation: -8, transformOrigin: "top center" },
        {
          rotation: 12,
          duration: 0.7,
          ease: "sine.inOut",
          yoyo: true,
          repeat: -1,
        }
      );

      // Blinking eyes
      const blink = () =>
        gsap.to(".dino-eye", {
          scaleY: 0.1,
          transformOrigin: "center center",
          duration: 0.08,
          yoyo: true,
          repeat: 1,
          onComplete: () => gsap.delayedCall(gsap.utils.random(1.5, 4), blink),
        });
      gsap.delayedCall(1.2, blink);

      // Drifting puff clouds
      gsap.to(".cloud", {
        x: "+=18",
        duration: 3,
        ease: "sine.inOut",
        yoyo: true,
        repeat: -1,
        stagger: 0.6,
      });

      // Pop-in on load
      gsap.from(".dino-body", {
        scale: 0,
        transformOrigin: "center bottom",
        duration: 0.9,
        ease: "back.out(1.7)",
      });
    },
    { scope: root }
  );

  return (
    <svg
      ref={root}
      viewBox="0 0 400 360"
      className="w-[min(80vw,460px)] h-auto drop-shadow-sm"
      role="img"
      aria-label="A cute white dinosaur waving"
    >
      {/* floating clouds */}
      <g fill="#ffffff" opacity="0.9">
        <g className="cloud">
          <circle cx="70" cy="70" r="16" />
          <circle cx="90" cy="70" r="20" />
          <circle cx="112" cy="72" r="14" />
        </g>
        <g className="cloud">
          <circle cx="300" cy="50" r="13" />
          <circle cx="318" cy="50" r="17" />
          <circle cx="336" cy="52" r="11" />
        </g>
      </g>

      {/* ground shadow */}
      <ellipse cx="200" cy="320" rx="90" ry="16" fill="#000000" opacity="0.06" />

      <g className="dino-body">
        {/* tail */}
        <path
          className="dino-tail"
          d="M150 250 Q90 250 70 215 Q105 240 150 230 Z"
          fill="#ffffff"
          stroke="#e7e9ef"
          strokeWidth="3"
        />

        {/* legs */}
        <rect x="170" y="280" width="22" height="34" rx="11" fill="#ffffff" stroke="#e7e9ef" strokeWidth="3" />
        <rect x="210" y="280" width="22" height="34" rx="11" fill="#ffffff" stroke="#e7e9ef" strokeWidth="3" />

        {/* body */}
        <path
          d="M150 250
             Q140 170 200 160
             Q265 165 262 235
             Q262 290 205 292
             Q150 292 150 250 Z"
          fill="#ffffff"
          stroke="#e7e9ef"
          strokeWidth="3"
        />

        {/* belly */}
        <path
          d="M178 250 Q180 285 208 286 Q236 285 240 250 Q232 268 208 268 Q186 268 178 250 Z"
          fill="#f5f6fa"
        />

        {/* tiny arm */}
        <path
          className="dino-arm"
          d="M250 215 Q272 210 276 232 Q266 224 252 228 Z"
          fill="#ffffff"
          stroke="#e7e9ef"
          strokeWidth="3"
        />

        {/* back spikes */}
        <g fill="#f0f1f6">
          <path d="M196 158 l10 -16 l10 16 Z" />
          <path d="M216 160 l9 -13 l9 13 Z" />
        </g>

        {/* head */}
        <circle cx="205" cy="155" r="58" fill="#ffffff" stroke="#e7e9ef" strokeWidth="3" />

        {/* head spikes */}
        <g fill="#f0f1f6">
          <path d="M188 104 l8 -16 l8 16 Z" />
          <path d="M206 100 l8 -16 l8 16 Z" />
        </g>

        {/* cheeks */}
        <circle cx="176" cy="168" r="9" fill="#ffd9e0" opacity="0.8" />
        <circle cx="234" cy="168" r="9" fill="#ffd9e0" opacity="0.8" />

        {/* eyes */}
        <circle className="dino-eye" cx="188" cy="150" r="6.5" fill="#3a3a45" />
        <circle className="dino-eye" cx="222" cy="150" r="6.5" fill="#3a3a45" />
        <circle cx="190" cy="148" r="2" fill="#ffffff" />
        <circle cx="224" cy="148" r="2" fill="#ffffff" />

        {/* smile */}
        <path
          d="M196 172 Q205 182 214 172"
          fill="none"
          stroke="#3a3a45"
          strokeWidth="3"
          strokeLinecap="round"
        />
      </g>
    </svg>
  );
}

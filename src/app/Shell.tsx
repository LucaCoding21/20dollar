"use client";

import { useState } from "react";
import BankApp from "./BankApp";
import FoodTierApp from "./FoodTierApp";

// The little "OS": a launcher home screen with one tile per app. Each app gets
// a way back here (the "⊞ apps" button inside it). Which app is open is just
// state — no router — so returning to an app keeps its own internal screen.
type AppId = "launcher" | "budget" | "food";

export default function Shell() {
  const [app, setApp] = useState<AppId>("launcher");

  if (app === "budget") return <BankApp onExitToApps={() => setApp("launcher")} />;
  if (app === "food") return <FoodTierApp onExit={() => setApp("launcher")} />;
  return <Launcher onOpen={setApp} />;
}

function AppTile({
  label,
  emoji,
  imageSrc,
  gradient,
  onClick,
}: {
  label: string;
  emoji?: string;
  imageSrc?: string;
  gradient: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-center gap-2 transition active:scale-95"
    >
      {imageSrc ? (
        <span className="flex h-[140px] w-[140px] items-center justify-center overflow-hidden rounded-[18px] bg-white">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageSrc} alt="" className="h-full w-full object-cover" />
        </span>
      ) : (
        <span
          className={`flex h-[140px] w-[140px] items-center justify-center rounded-[18px] text-[64px] ${gradient}`}
        >
          {emoji}
        </span>
      )}
      <span className="text-[17px] text-[#2b2b2b] drop-shadow-[0_1px_2px_rgba(255,255,255,0.6)]">
        {label}
      </span>
    </button>
  );
}

function Launcher({ onOpen }: { onOpen: (app: AppId) => void }) {
  return (
    <div className="relative mx-auto flex min-h-dvh w-full max-w-[420px] flex-col px-6 pb-12 pt-[max(env(safe-area-inset-top),32px)]">
      <header className="mt-6 text-center">
        <h1 className="font-daruma text-[40px] leading-none text-[#3a4a63] drop-shadow-[0_2px_3px_rgba(255,255,255,0.7)]">
          Baba&apos;s Apps
        </h1>
        <p className="mt-2 text-[13px] text-[#5a6678] drop-shadow-[0_1px_2px_rgba(255,255,255,0.7)]">
          Select an app
        </p>
      </header>

      <div className="mt-14 grid grid-cols-2 justify-items-center gap-5">
        <AppTile
          label="Budget"
          imageSrc="/money.png"
          gradient="bg-gradient-to-b from-[#6790dc] to-[#5181d4]"
          onClick={() => onOpen("budget")}
        />
        <AppTile
          label="Food Tiers"
          imageSrc="/ramen.png"
          gradient="bg-gradient-to-b from-[#ffb86b] to-[#ff8f6b]"
          onClick={() => onOpen("food")}
        />
      </div>
    </div>
  );
}

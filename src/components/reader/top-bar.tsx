"use client";

import { ArrowLeft, Headphones, List, MessageCircleQuestionMark, NotebookPen } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Panel } from "./config";
import { IconBtn } from "./kit";

export function TopBar({
  title,
  visible,
  panel,
  onToggle,
  onBack,
  listening,
  onListen,
}: {
  title: string | undefined;
  visible: boolean;
  panel: Panel | null;
  onToggle: (p: Panel) => void;
  onBack: () => void;
  listening: boolean;
  onListen: () => void;
}) {
  const on = (...ps: Panel[]) => panel !== null && ps.includes(panel);
  return (
    <header
      className={cn(
        "absolute inset-x-0 top-0 z-20 flex h-[calc(3.5rem+env(safe-area-inset-top))] items-center gap-2 px-2 pt-[env(safe-area-inset-top)] transition-opacity duration-300 pointer-coarse:px-1 sm:px-4",
        // Sideways phones: the bar floats over the page, so it gets the page colour behind it and clears the notch.
        "short:h-12 short:border-b short:border-border short:bg-background short:pr-[max(0.5rem,env(safe-area-inset-right))] short:pl-[max(0.5rem,env(safe-area-inset-left))]",
        visible ? "opacity-100" : "pointer-events-none opacity-0",
      )}
    >
      {/* Equal-growing sides keep the title centred on the page while the right side is wider. */}
      <div className="flex flex-1 basis-0 items-center">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg pr-3 pl-2 text-sm font-medium text-muted-foreground transition-colors duration-150 outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 pointer-coarse:h-11 [&_svg]:size-[18px]"
        >
          <ArrowLeft />
          Library
        </button>
      </div>
      <p className="hidden max-w-md min-w-0 shrink truncate text-center text-sm text-muted-foreground sm:block">{title}</p>
      <div className="flex flex-1 basis-0 items-center justify-end gap-1 pointer-coarse:gap-2">
        <IconBtn label="Audiobook" aria-pressed={listening} active={listening} onClick={onListen}>
          <Headphones />
        </IconBtn>
        {/* One button for "ask" and "recap", two views of the same companion switched inside the panel; it closes either. */}
        <IconBtn label="Ask" active={on("ask", "recap")} onClick={() => onToggle(panel === "recap" ? "recap" : "ask")}>
          <MessageCircleQuestionMark />
        </IconBtn>
        <IconBtn label="Notebook" active={on("notebook")} onClick={() => onToggle("notebook")}>
          <NotebookPen />
        </IconBtn>
        <IconBtn label="Contents" active={on("toc")} onClick={() => onToggle("toc")}>
          <List />
        </IconBtn>
        <IconBtn label="Text and theme" active={on("type")} onClick={() => onToggle("type")} className="text-base font-semibold">
          Aa
        </IconBtn>
      </div>
    </header>
  );
}

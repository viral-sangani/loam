"use client";

import { ArrowLeft, Headphones, Keyboard, List } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Panel } from "./config";

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
  const icon = (p: Panel) => cn("text-muted-foreground pointer-coarse:size-11", panel === p && "bg-muted text-foreground");
  return (
    <header
      className={cn(
        "absolute inset-x-0 top-0 z-20 flex items-center justify-between gap-2 px-2 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2 transition-opacity duration-500 sm:px-6 sm:pt-3",
        visible ? "opacity-100" : "pointer-events-none opacity-0",
      )}
    >
      <Button variant="ghost" size="sm" className="text-muted-foreground pointer-coarse:h-11 pointer-coarse:px-3" onClick={onBack}>
        <ArrowLeft /> Shelf
      </Button>
      <p className="hidden min-w-0 flex-1 truncate text-center font-serif text-sm text-muted-foreground italic sm:block">{title}</p>
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="icon" aria-label="Keyboard shortcuts" className={cn(icon("keys"), "pointer-coarse:hidden")} onClick={() => onToggle("keys")}>
          <Keyboard />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Audiobook"
          aria-pressed={listening}
          className={cn("text-muted-foreground pointer-coarse:size-11", listening && "bg-muted text-foreground")}
          onClick={onListen}
        >
          <Headphones />
        </Button>
        <Button variant="ghost" size="icon" aria-label="Contents" className={icon("toc")} onClick={() => onToggle("toc")}>
          <List />
        </Button>
        <Button variant="ghost" size="icon" aria-label="Text settings" className={cn(icon("type"), "font-serif text-base")} onClick={() => onToggle("type")}>
          Aa
        </Button>
      </div>
    </header>
  );
}

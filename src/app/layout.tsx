import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Providers } from "@/components/providers";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Loam",
  description: "An EPUB reader with highlights, notes, audiobook sync and an AI reading companion.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#efe6d4" },
    { media: "(prefers-color-scheme: dark)", color: "#221c17" },
  ],
};

/** Runs before first paint: marks the library view and the reader theme, so pages start in the right colour. */
const LIB_VIEW = `try{var v=localStorage.getItem("loam:library-view");if(v!=="room"&&v!=="list"){var q=["(max-width: 767px)","(orientation: landscape) and (max-height: 500px)","(prefers-reduced-motion: reduce)"];v=q.some(function(m){return matchMedia(m).matches})?"list":"room"}document.documentElement.dataset.lib=v;var t=(JSON.parse(localStorage.getItem("loam:reader-prefs")||"{}")||{}).theme;document.documentElement.dataset.page=t==="dark"||t==="night"?"night":t==="sepia"?"sepia":"paper"}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: LIB_VIEW }} />
      </head>
      <body className="relative min-h-full flex flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

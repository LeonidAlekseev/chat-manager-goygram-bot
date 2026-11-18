import localFont from "next/font/local"

import { cn } from "@/lib/utils"

import "./globals.css"

import { Providers } from "@/providers"

import type { Metadata } from "next"
import type { ReactNode } from "react"

import { Toaster as Sonner } from "@/components/ui/sonner"
import { Toaster } from "@/components/ui/toaster"

// Define metadata for the application
// More info: https://nextjs.org/docs/app/building-your-application/optimizing/metadata
export const metadata: Metadata = {
  title: {
    template: "%s | OzonWaao",
    default: "OzonWaao",
  },
  description: "",
  metadataBase: new URL(process.env.BASE_URL ?? "http://localhost:3000"),
}

// Define fonts for the application
// More info: https://nextjs.org/docs/app/building-your-application/optimizing/fonts
// Self-hosted (SIL OFL, see fonts/OFL-Lato.txt) so the build never needs Google Fonts.
const latoFont = localFont({
  src: [
    { path: "./fonts/Lato-Light.ttf", weight: "300", style: "normal" },
    { path: "./fonts/Lato-Regular.ttf", weight: "400", style: "normal" },
    { path: "./fonts/Lato-Italic.ttf", weight: "400", style: "italic" },
    { path: "./fonts/Lato-Bold.ttf", weight: "700", style: "normal" },
    { path: "./fonts/Lato-Black.ttf", weight: "900", style: "normal" },
  ],
  variable: "--font-lato",
})

export default function RootLayout(props: { children: ReactNode }) {
  const { children } = props

  return (
    <html lang="ru" dir="ltr" className="light" suppressHydrationWarning>
      <body
        className={cn(
          "font-lato",
          "bg-background text-foreground antialiased overscroll-none overflow-x-hidden", // Set background, text, , anti-aliasing styles, and overscroll behavior
          latoFont.variable
        )}
      >
        <Providers locale="en">
          {children}
          <Toaster />
          <Sonner />
        </Providers>
      </body>
    </html>
  )
}

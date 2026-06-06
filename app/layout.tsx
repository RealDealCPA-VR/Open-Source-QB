import "./globals.css";
import { Toaster } from "@/components/ui";
import AppShell from "@/components/AppShell";

export const metadata = {
  title: "BookKeeper AI",
  description: "Open-source desktop accounting with AI error correction.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;900&display=swap" rel="stylesheet" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta charSet="UTF-8" />
      </head>
      <body className="bg-offwhite font-sans antialiased min-h-screen">
        <AppShell>{children}</AppShell>
        <Toaster />
      </body>
    </html>
  );
}

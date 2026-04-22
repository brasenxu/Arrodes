import { Chat } from "@/components/chat";

export default function Page() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col px-4 py-8">
      <header className="mb-6 border-b border-white/10 pb-4">
        <h1 className="text-2xl font-semibold tracking-tight">Arrodes</h1>
        <p className="text-sm text-white/60">
          Lord of the Mysteries + Circle of Inevitability, grounded in the
          canonical translation.
        </p>
      </header>
      <Chat />
    </main>
  );
}

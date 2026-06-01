import BankApp from "./BankApp";

export default function Home() {
  return (
    <main className="relative flex flex-1 flex-col">
      {/* Fixed cloud backdrop (bg-fixed is unreliable in iOS Safari, so we
          pin a real element behind the scrolling content instead). */}
      <div
        aria-hidden
        className="fixed inset-0 -z-10 bg-cover bg-center"
        style={{ backgroundImage: "url('/clouds.webp')" }}
      />
      <BankApp />
    </main>
  );
}

/** The N●X wordmark, as used in the landing page's corner. */
export function NoxMark({ size = 24 }: { size?: number }) {
  return (
    <span className="flex select-none items-center font-sans font-semibold leading-none text-ink" style={{ fontSize: size }}>
      N
      <span
        aria-hidden
        className="mx-[2px] inline-block rounded-full"
        style={{
          width: "0.76em",
          height: "0.76em",
          background: "radial-gradient(circle at 34% 30%, #FFF7E2, #FFDD82 42%, #F7B542 68%, #E9713C 100%)",
          boxShadow: "0 0 10px 2px rgb(var(--nox-rgb)/.5)",
        }}
      />
      X
    </span>
  );
}

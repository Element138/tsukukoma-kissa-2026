"use client";

type LoadingScreenProps = {
  label?: string;
};

export function LoadingScreen(props: LoadingScreenProps) {
  return (
    <main className="loading-screen">
      <div className="loading-screen-inner">
        <div className="loading-spinner" aria-hidden="true" />
        <p>{props.label ?? "Loading data..."}</p>
      </div>
    </main>
  );
}

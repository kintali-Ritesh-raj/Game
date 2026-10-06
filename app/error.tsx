'use client';
export default function ErrorPage({reset}:{reset:()=>void}) { return <main className="connection-page"><h1>Let’s reconnect.</h1><p>Your accepted moves are saved in your room.</p><button className="primary" onClick={reset}>Try again</button><a href="/">Main menu</a></main>; }

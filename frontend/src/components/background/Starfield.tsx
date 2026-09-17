/**
 * src/components/background/Starfield.tsx
 * --------------------------------------------
 * Subtle HTML5 canvas ambient particle field for LandingPage's hero.
 * Purely decorative — no interactivity, low opacity, ignores pointer
 * events so it never intercepts clicks on content above it.
 */

import { useEffect, useRef } from "react";

interface Particle {
  x: number;
  y: number;
  radius: number;
  vx: number;
  vy: number;
  alpha: number;
}

const PARTICLE_COUNT = 90;

export default function Starfield() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let width = 0;
    let height = 0;
    let particles: Particle[] = [];
    let animationFrame = 0;

    function resize() {
      const c = canvasRef.current;
      if (!c) return;
      width = c.clientWidth;
      height = c.clientHeight;
      c.width = width * window.devicePixelRatio;
      c.height = height * window.devicePixelRatio;
      ctx!.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
    }

    function initParticles() {
      particles = Array.from({ length: PARTICLE_COUNT }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        radius: Math.random() * 1.4 + 0.3,
        vx: (Math.random() - 0.5) * 0.12,
        vy: (Math.random() - 0.5) * 0.12,
        alpha: Math.random() * 0.5 + 0.2,
      }));
    }

    function tick() {
      ctx!.clearRect(0, 0, width, height);
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0) p.x = width;
        if (p.x > width) p.x = 0;
        if (p.y < 0) p.y = height;
        if (p.y > height) p.y = 0;

        ctx!.beginPath();
        ctx!.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx!.fillStyle = `rgba(255, 255, 255, ${p.alpha})`; // white sparkle dots over the warm hero gradient
        ctx!.fill();
      }
      animationFrame = requestAnimationFrame(tick);
    }

    resize();
    initParticles();
    tick();

    const handleResize = () => {
      resize();
      initParticles();
    };
    window.addEventListener("resize", handleResize);

    return () => {
      cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none absolute inset-0 h-full w-full opacity-40"
      aria-hidden="true"
    />
  );
}

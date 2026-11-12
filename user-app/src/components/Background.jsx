import { useEffect, useRef } from 'react';

/**
 * Code-generated "video-like" animated background: a slow moving gradient field
 * plus drifting embers with connecting lines. GPU-friendly and disabled for
 * users who prefer reduced motion.
 */
export default function Background({ intensity = 1 }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    let width = 0;
    let height = 0;
    let raf = 0;
    let particles = [];

    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const resize = () => {
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.round(Math.min(90, (width * height) / 22000) * intensity);
      particles = Array.from({ length: count }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.22,
        vy: -0.08 - Math.random() * 0.3,
        r: 0.6 + Math.random() * 1.7,
        hue: Math.random() > 0.5 ? 18 : 335,
        a: 0.25 + Math.random() * 0.55,
      }));
    };

    let t = 0;
    const draw = () => {
      t += 0.005;
      ctx.clearRect(0, 0, width, height);

      const glow = ctx.createRadialGradient(
        width * (0.5 + Math.sin(t) * 0.14),
        height * (0.18 + Math.cos(t * 0.8) * 0.08),
        0,
        width * 0.5,
        height * 0.2,
        Math.max(width, height) * 0.75,
      );
      glow.addColorStop(0, 'rgba(255, 90, 31, 0.11)');
      glow.addColorStop(0.45, 'rgba(255, 45, 120, 0.05)');
      glow.addColorStop(1, 'rgba(6, 6, 11, 0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, width, height);

      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.y < -10) {
          p.y = height + 10;
          p.x = Math.random() * width;
        }
        if (p.x < -10) p.x = width + 10;
        if (p.x > width + 10) p.x = -10;

        ctx.beginPath();
        ctx.fillStyle = `hsla(${p.hue}, 92%, 60%, ${p.a})`;
        ctx.shadowColor = `hsla(${p.hue}, 95%, 62%, ${p.a})`;
        ctx.shadowBlur = 12;
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.shadowBlur = 0;

      // faint constellation lines between nearby embers
      for (let i = 0; i < particles.length; i += 1) {
        for (let j = i + 1; j < particles.length; j += 1) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const dist = Math.hypot(dx, dy);
          if (dist < 92) {
            ctx.strokeStyle = `rgba(255, 120, 60, ${0.055 * (1 - dist / 92)})`;
            ctx.lineWidth = 0.7;
            ctx.beginPath();
            ctx.moveTo(particles[i].x, particles[i].y);
            ctx.lineTo(particles[j].x, particles[j].y);
            ctx.stroke();
          }
        }
      }

      if (!reduce) raf = requestAnimationFrame(draw);
    };

    resize();
    draw();
    window.addEventListener('resize', resize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, [intensity]);

  return (
    <>
      <canvas ref={canvasRef} className="bg-canvas" aria-hidden="true" />
      <div className="bg-glow" aria-hidden="true" />
      <div className="grid-overlay" aria-hidden="true" />
    </>
  );
}

"use client";

import { useEffect, useRef } from "react";

type ContainmentSceneProps = {
  progress: number;
};

type SceneNode = {
  id: string;
  label: string;
  x: number;
  y: number;
  radius: number;
  kind: "root" | "agent" | "decision" | "action";
};

const nodes: SceneNode[] = [
  { id: "root", label: "POISONED MEMORY", x: 0.29, y: 0.46, radius: 22, kind: "root" },
  { id: "procurement", label: "RETRIEVAL", x: 0.48, y: 0.24, radius: 12, kind: "agent" },
  { id: "finance", label: "FINANCE AGENT", x: 0.57, y: 0.63, radius: 14, kind: "agent" },
  { id: "approval", label: "APPROVAL", x: 0.73, y: 0.38, radius: 13, kind: "decision" },
  { id: "action", label: "EXTERNAL ACTION", x: 0.82, y: 0.68, radius: 15, kind: "action" },
];

const paths: Array<[string, string]> = [
  ["root", "procurement"],
  ["root", "finance"],
  ["procurement", "approval"],
  ["finance", "approval"],
  ["approval", "action"],
];

function pointFor(node: SceneNode, width: number, height: number, parallaxX: number, parallaxY: number) {
  const depth = node.kind === "root" ? 1 : node.kind === "action" ? 0.3 : 0.62;
  return {
    x: node.x * width + parallaxX * depth,
    y: node.y * height + parallaxY * depth,
  };
}

function clamp(value: number, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function ContainmentScene({ progress }: ContainmentSceneProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const progressRef = useRef(progress);
  progressRef.current = progress;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    const parent = canvas.parentElement;
    if (!parent) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    let running = false;
    let inView = true;
    let isVisible = document.visibilityState === "visible";
    let pointerX = 0;
    let pointerY = 0;
    let targetX = 0;
    let targetY = 0;
    let width = 0;
    let height = 0;
    let ratio = 1;

    const getNode = (id: string) => nodes.find((node) => node.id === id)!;

    const resize = () => {
      const bounds = parent.getBoundingClientRect();
      ratio = Math.min(window.devicePixelRatio || 1, 2);
      width = Math.max(1, bounds.width);
      height = Math.max(1, bounds.height);
      canvas.width = Math.floor(width * ratio);
      canvas.height = Math.floor(height * ratio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };

    const line = (from: SceneNode, to: SceneNode, color: string, alpha = 1, dash: number[] = [], reveal = 1) => {
      const start = pointFor(from, width, height, pointerX, pointerY);
      const end = pointFor(to, width, height, pointerX, pointerY);
      const visibleEnd = {
        x: start.x + (end.x - start.x) * reveal,
        y: start.y + (end.y - start.y) * reveal,
      };
      context.save();
      context.beginPath();
      context.setLineDash(dash);
      context.strokeStyle = color;
      context.globalAlpha = alpha;
      context.lineWidth = 1;
      context.moveTo(start.x, start.y);
      context.lineTo(visibleEnd.x, visibleEnd.y);
      context.stroke();
      context.restore();
    };

    const drawPulse = (from: SceneNode, to: SceneNode, progress: number, color: string) => {
      const start = pointFor(from, width, height, pointerX, pointerY);
      const end = pointFor(to, width, height, pointerX, pointerY);
      const x = start.x + (end.x - start.x) * progress;
      const y = start.y + (end.y - start.y) * progress;
      const gradient = context.createRadialGradient(x, y, 0, x, y, 18);
      gradient.addColorStop(0, color);
      gradient.addColorStop(0.18, color);
      gradient.addColorStop(1, "rgba(0,0,0,0)");
      context.save();
      context.fillStyle = gradient;
      context.globalAlpha = 0.92;
      context.beginPath();
      context.arc(x, y, 18, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = color;
      context.beginPath();
      context.arc(x, y, 2.4, 0, Math.PI * 2);
      context.fill();
      context.restore();
    };

    const drawNode = (node: SceneNode, time: number, reveal: number, recoveryPlan: boolean) => {
      if (reveal <= 0) return;
      const point = pointFor(node, width, height, pointerX, pointerY);
      const statusColor = recoveryPlan ? "#ff5a1f" : node.kind === "root" || node.kind === "action" ? "#b23a2b" : "#17150f";
      const ring = node.kind === "root" ? node.radius + 20 + Math.sin(time * 0.002) * 2 : node.radius + 9;

      context.save();
      context.globalAlpha = reveal;
      context.strokeStyle = statusColor;
      context.globalAlpha = reveal * (node.kind === "root" ? 0.42 : 0.25);
      context.lineWidth = 1;
      context.setLineDash(node.kind === "root" ? [3, 5] : []);
      context.beginPath();
      context.arc(point.x, point.y, ring, 0, Math.PI * 2);
      context.stroke();
      context.setLineDash([]);

      context.fillStyle = "#fff9e9";
      context.globalAlpha = reveal * 0.97;
      context.beginPath();
      if (node.kind === "decision") {
        context.roundRect(point.x - node.radius, point.y - node.radius * 0.63, node.radius * 2, node.radius * 1.26, node.radius * 0.63);
      } else if (node.kind === "action") {
        context.moveTo(point.x, point.y - node.radius);
        context.lineTo(point.x + node.radius, point.y + node.radius * 0.86);
        context.lineTo(point.x - node.radius, point.y + node.radius * 0.86);
        context.closePath();
      } else if (node.kind === "agent") {
        context.arc(point.x, point.y, node.radius, 0, Math.PI * 2);
      } else {
        context.rect(point.x - node.radius, point.y - node.radius, node.radius * 2, node.radius * 2);
      }
      context.fill();
      context.strokeStyle = statusColor;
      context.globalAlpha = reveal;
      context.lineWidth = node.kind === "root" ? 2 : 1.2;
      context.stroke();

      context.fillStyle = "#17150f";
      context.font = `600 ${node.kind === "root" ? 10 : 8}px "SFMono-Regular", Consolas, monospace`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(node.kind === "root" ? "M" : node.kind === "agent" ? "A" : node.kind === "decision" ? "D" : "$", point.x, point.y + 0.5);

      context.globalAlpha = reveal * 0.8;
      context.fillStyle = "#5f584b";
      context.font = `600 8px "SFMono-Regular", Consolas, monospace`;
      context.textBaseline = "top";
      context.fillText(node.label, point.x, point.y + node.radius + 18);
      context.restore();
    };

    const draw = (time: number) => {
      context.clearRect(0, 0, width, height);
      pointerX += (targetX - pointerX) * 0.045;
      pointerY += (targetY - pointerY) * 0.045;
      const trace = reduceMotion.matches ? 1 : clamp(progressRef.current);
      const recoveryPlan = trace >= 0.76;

      const radial = context.createRadialGradient(width * 0.48, height * 0.49, 0, width * 0.48, height * 0.49, Math.max(width, height) * 0.6);
      radial.addColorStop(0, "rgba(255,90,31,0.11)");
      radial.addColorStop(0.55, "rgba(238,233,218,0)");
      radial.addColorStop(1, "rgba(238,233,218,0.72)");
      context.fillStyle = radial;
      context.fillRect(0, 0, width, height);

      paths.forEach(([from, to]) => {
        line(getNode(from), getNode(to), "#17150f", 0.14, [2, 8], 1);
      });

      paths.forEach(([from, to], index) => {
        const reveal = clamp((trace * 1.16 - index * 0.15) / 0.25);
        line(getNode(from), getNode(to), recoveryPlan ? "#ff5a1f" : "#b23a2b", 0.22 + reveal * 0.34, [4, 7], reveal);
      });
      if (trace > 0.7) line(getNode("root"), getNode("approval"), "#17150f", clamp((trace - 0.7) * 2.8) * 0.26, [], clamp((trace - 0.7) * 3.3));

      if (!reduceMotion.matches) {
        const flow = trace < 0.08 ? (time % 2600) / 2600 * 0.08 : trace;
        const sequence = paths;
        const segment = Math.min(sequence.length - 1, Math.floor(flow * sequence.length));
        const local = clamp((flow * sequence.length) % 1);
        const [fromId, toId] = sequence[segment];
        drawPulse(getNode(fromId), getNode(toId), local, recoveryPlan ? "#ff5a1f" : "#b23a2b");
      }

      nodes.forEach((node, index) => {
        const reveal = index === 0 ? 1 : Math.max(0.38, clamp((trace - (index - 1) * 0.16) / 0.19));
        drawNode(node, time, reveal, recoveryPlan);
      });

      if (recoveryPlan) {
        const root = pointFor(getNode("root"), width, height, pointerX, pointerY);
        context.save();
        context.strokeStyle = "#ff5a1f";
        context.globalAlpha = clamp((trace - 0.76) * 4.2) * 0.75;
        context.lineWidth = 1;
        context.beginPath();
        context.arc(root.x, root.y, 54, 0, Math.PI * 2);
        context.stroke();
        context.restore();
      }
    };

    const tick = (time: number) => {
      frame = 0;
      draw(time);
      if (running && !reduceMotion.matches) frame = requestAnimationFrame(tick);
    };

    const render = () => {
      if (!frame) frame = requestAnimationFrame(tick);
    };

    const updateRunning = () => {
      running = inView && isVisible && !reduceMotion.matches;
      if (running) render();
      else {
        if (frame) cancelAnimationFrame(frame);
        frame = 0;
        draw(performance.now());
      }
    };

    const onPointerMove = (event: PointerEvent) => {
      const bounds = parent.getBoundingClientRect();
      targetX = ((event.clientX - bounds.left) / bounds.width - 0.5) * 36;
      targetY = ((event.clientY - bounds.top) / bounds.height - 0.5) * 24;
      if (!reduceMotion.matches) render();
    };

    const onPointerLeave = () => {
      targetX = 0;
      targetY = 0;
    };

    const onVisibility = () => {
      isVisible = document.visibilityState === "visible";
      updateRunning();
    };

    const observer = new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting;
      updateRunning();
    }, { threshold: 0.05 });

    resize();
    draw(performance.now());
    observer.observe(parent);
    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    parent.addEventListener("pointerleave", onPointerLeave);
    document.addEventListener("visibilitychange", onVisibility);
    reduceMotion.addEventListener("change", updateRunning);
    updateRunning();

    return () => {
      if (frame) cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onPointerMove);
      parent.removeEventListener("pointerleave", onPointerLeave);
      document.removeEventListener("visibilitychange", onVisibility);
      reduceMotion.removeEventListener("change", updateRunning);
    };
  }, []);

  return <canvas ref={canvasRef} className="containmentCanvas" aria-hidden="true" />;
}

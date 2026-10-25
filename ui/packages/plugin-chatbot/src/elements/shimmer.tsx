/*!
 * Sourced from vercel/ai-elements (https://elements.ai-sdk.dev) — MIT.
 * Vendored via the shadcn-style copy-into-source model. Do NOT edit business
 * logic directly; create a wrapper next to the consumer instead. To re-sync,
 * fetch the latest from https://registry.ai-sdk.dev/<name>.json.
 */
"use client";

import { cn } from "@object-ui/components";
import { motion } from "motion/react";
import {
  type CSSProperties,
  type ElementType,
  type JSX,
  memo,
  useMemo,
} from "react";

export type TextShimmerProps = {
  children: string;
  as?: ElementType;
  className?: string;
  duration?: number;
  spread?: number;
};

const ShimmerComponent = ({
  children,
  as: Component = "p",
  className,
  duration = 2,
  spread = 2,
}: TextShimmerProps) => {
  // motion.create() builds a fresh motion component; it must key off the `as`
  // prop so it can't be hoisted to module scope. Memoize per `Component` so it
  // stays a stable reference across renders (react-hooks/static-components)
  // instead of being re-created — and re-mounting — every render.
  const MotionComponent = useMemo(
    () => motion.create(Component as keyof JSX.IntrinsicElements),
    [Component],
  );

  const dynamicSpread = useMemo(
    () => (children?.length ?? 0) * spread,
    [children, spread]
  );

  return (
    // eslint-disable-next-line react-hooks/static-components -- MotionComponent is memoized per `as` prop above (stable across renders); motion.create needs the runtime tag, so it can't be declared at module scope
    <MotionComponent
      animate={{ backgroundPosition: "0% center" }}
      className={cn(
        "relative inline-block bg-[length:250%_100%,auto] bg-clip-text text-transparent",
        "[--bg:linear-gradient(90deg,#0000_calc(50%-var(--spread)),var(--color-background),#0000_calc(50%+var(--spread)))] [background-repeat:no-repeat,padding-box]",
        className
      )}
      initial={{ backgroundPosition: "100% center" }}
      style={
        {
          "--spread": `${dynamicSpread}px`,
          backgroundImage:
            "var(--bg), linear-gradient(var(--color-muted-foreground), var(--color-muted-foreground))",
        } as CSSProperties
      }
      transition={{
        repeat: Number.POSITIVE_INFINITY,
        duration,
        ease: "linear",
      }}
    >
      {children}
    </MotionComponent>
  );
};

export const Shimmer = memo(ShimmerComponent);


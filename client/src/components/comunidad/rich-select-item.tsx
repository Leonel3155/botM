import { forwardRef, type ComponentPropsWithoutRef, type ElementRef, type ReactNode } from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface RichSelectItemProps extends ComponentPropsWithoutRef<typeof SelectPrimitive.Item> {
  /**
   * Segunda línea gris (p. ej. por qué no se puede elegir). Va fuera del texto del
   * elemento, así que no aparece en el botón del selector cuando está elegido.
   */
  hint?: ReactNode;
}

/** Como SelectItem de ui/select, pero con una línea de ayuda debajo. */
export const RichSelectItem = forwardRef<ElementRef<typeof SelectPrimitive.Item>, RichSelectItemProps>(
  ({ className, children, hint, ...props }, ref) => (
    <SelectPrimitive.Item
      ref={ref}
      className={cn(
        "relative flex w-full cursor-default select-none items-start rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-60",
        className,
      )}
      {...props}
    >
      <span className="absolute left-2 top-2 flex h-3.5 w-3.5 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <Check className="h-4 w-4" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
        {hint && <span className="text-xs leading-snug text-muted-foreground">{hint}</span>}
      </span>
    </SelectPrimitive.Item>
  ),
);
RichSelectItem.displayName = "RichSelectItem";

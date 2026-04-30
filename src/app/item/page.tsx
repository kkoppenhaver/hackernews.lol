import { Suspense } from "react";
import HnApp from "@/components/HnApp";

export default function Item() {
  return (
    <Suspense fallback={null}>
      <HnApp basePath="/item" />
    </Suspense>
  );
}

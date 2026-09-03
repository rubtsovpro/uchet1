#!/usr/bin/env python3
import os
import re
import sys
import zipfile


def inspect(path: str) -> None:
    print("\n====", os.path.basename(path))
    with zipfile.ZipFile(path) as z:
        names = z.namelist()
        media = [
            n
            for n in names
            if "media" in n.lower()
            or re.search(r"\.(png|jpe?g|gif|webp|emf|wmf)$", n, re.I)
        ]
        drawings = [n for n in names if "drawing" in n.lower() and not n.endswith(".rels")]
        print("total", len(names), "media", len(media), "drawings", len(drawings))
        print("media sample", media[:15])
        for d in drawings[:3]:
            data = z.read(d).decode("utf-8", errors="ignore")
            print(d, "anchors", data.count("twoCellAnchor"), data.count("oneCellAnchor"))
            # first row of each from-anchor
            from_blocks = re.findall(
                r"<xdr:from>(.*?)</xdr:from>", data, flags=re.S
            )[:5]
            for i, b in enumerate(from_blocks):
                col = re.search(r"<xdr:col>(\d+)</xdr:col>", b)
                row = re.search(r"<xdr:row>(\d+)</xdr:row>", b)
                print(
                    "  from",
                    i,
                    "col",
                    col.group(1) if col else "?",
                    "row",
                    row.group(1) if row else "?",
                )
            embeds = re.findall(r'r:embed="(rId\d+)"', data)[:8]
            print("  embeds", embeds)
            rel = os.path.dirname(d) + "/_rels/" + os.path.basename(d) + ".rels"
            if rel in names:
                rels = z.read(rel).decode("utf-8", errors="ignore")
                print(
                    "  rels",
                    re.findall(r'Id="(rId\d+)"[^>]*Target="([^"]+)"', rels)[:10],
                )


def main() -> None:
    base = sys.argv[1] if len(sys.argv) > 1 else "data/purchase-intake"
    folders = [
        "ea574d3b-decc-4e26-b48c-d84cfc1d2e7d",
        "b6dc3796-2721-4db1-9e52-cd14f43bc9d9",
        "6531a173-505b-4472-91dc-ea0a3c84fab7",
    ]
    for folder in folders:
        d = os.path.join(base, folder)
        if not os.path.isdir(d):
            continue
        files = [f for f in os.listdir(d) if f.endswith((".xlsx", ".xlsm"))]
        if files:
            inspect(os.path.join(d, files[0]))


if __name__ == "__main__":
    main()

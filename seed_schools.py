"""
Re-extrae los 23,447 centros educativos desde el Excel SACE 2024
y genera:
  - schools.csv  (UTF-8 limpio, listo para COPY a Supabase)
  - centros.json (formato PWA, UTF-8 limpio, para buscador cliente)
"""
import csv
import json
import os
import sys
import unicodedata

import openpyxl

EXCEL = r"C:\Users\gabri\Desktop\IHER - Proyecto Cadena de Suministro 2026\05 - Datos Base\AVANCE DE MATRICULA 2024 SACE Finales  (1).xlsx"
OUT_DIR = os.path.dirname(os.path.abspath(__file__))
CSV_OUT = os.path.join(OUT_DIR, "schools.csv")
JSON_OUT = os.path.join(OUT_DIR, "centros.json")

# El archivo tiene tilde en "MATRÍCULA" y doble espacio. Localiza el real.
def locate_excel():
    if os.path.exists(EXCEL):
        return EXCEL
    base = os.path.dirname(EXCEL)
    for f in os.listdir(base):
        if "MATR" in f.upper() and f.lower().endswith(".xlsx"):
            return os.path.join(base, f)
    raise FileNotFoundError(EXCEL)


def clean(s):
    """Normaliza Unicode, elimina replacement char, trim."""
    if s is None:
        return ""
    t = str(s).strip()
    t = unicodedata.normalize("NFC", t)
    t = t.replace("\ufffd", "")
    return t


def main():
    path = locate_excel()
    print(f"Leyendo {path} ...")
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws = wb["POR GRADOS Y EDADES"]

    centros = {}
    total = 0
    for row in ws.iter_rows(min_row=2, values_only=True):
        total += 1
        codigo = row[6]
        if codigo is None:
            continue
        codigo = clean(codigo)
        if not codigo:
            continue
        if codigo not in centros:
            centros[codigo] = {
                "c": codigo,
                "n": clean(row[8]),
                "d": clean(row[1]),
                "m": clean(row[2]),
                "a": clean(row[3]),
                "z": clean(row[12]),
                "t": clean(row[15]),
                "ci": clean(row[14]),
                "ad": clean(row[11]),
                "mt": 0,
            }
        ini = row[27]
        if isinstance(ini, (int, float)):
            centros[codigo]["mt"] += int(ini)
    wb.close()

    lista = sorted(centros.values(), key=lambda x: (x["d"], x["n"]))
    print(f"Filas procesadas: {total:,}  |  Centros unicos: {len(lista):,}")

    # JSON para la PWA
    with open(JSON_OUT, "w", encoding="utf-8") as f:
        json.dump(lista, f, ensure_ascii=False, separators=(",", ":"))
    print(f"  -> {JSON_OUT}  ({os.path.getsize(JSON_OUT):,} bytes)")

    # CSV para Supabase COPY
    with open(CSV_OUT, "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow([
            "sace_code", "name", "department", "municipio", "localidad",
            "zone", "school_type", "cycle", "administration", "enrollment_2024",
        ])
        for c in lista:
            w.writerow([
                c["c"], c["n"], c["d"], c["m"], c["a"],
                c["z"], c["t"], c["ci"], c["ad"], c["mt"],
            ])
    print(f"  -> {CSV_OUT}  ({os.path.getsize(CSV_OUT):,} bytes)")


if __name__ == "__main__":
    sys.exit(main())

# USD/MXN — datos y modelo de proyección

## Resultado

La proyección utiliza 2.298 cierres de USD/MXN desde enero de 2018 y 622 velas OHLC de Massive desde septiembre de 2024. El escenario a seis meses se calcula con 4.000 trayectorias y 126 sesiones. La salida se expresa como mediana, bandas P25–P75 y P10–P90, y frecuencias de target/stop.

## Variables incorporadas

| Variable | Serie | Frecuencia | Observaciones descargadas | Uso |
|---|---|---:|---:|---|
| USD/MXN | DEXMXUS + Massive | Diaria | 2.298 cierres / 622 OHLC | Precio, retornos y backtest |
| Tasa efectiva Fed | DFF | Diaria | 3.175 | Diferencial de tasas |
| Dólar amplio | DTWEXBGS | Diaria | 2.166 | Fortaleza general del USD |
| Volatilidad | VIXCLS | Diaria | 2.218 | Régimen de riesgo |
| Petróleo WTI | DCOILWTICO | Diaria | 2.171 | Contexto de materias primas |
| S&P 500 | SP500 | Diaria | 2.185 | Régimen risk-on/risk-off |
| Tasa interbancaria México | IRSTCI01MXM156N | Mensual | 102 | Diferencial MX–US |
| IPC estadounidense | CPIAUCSL | Mensual | 103 | Contexto de inflación |
| Inflación mexicana | CPALTT01MXM659N | Mensual | 79, hasta julio de 2024 | Contexto; excluida de la señal actual |

Las series de distinta frecuencia se alinean por la última observación conocida, sin utilizar valores futuros. Los vacíos no se interpolan con información posterior.

## Modelo

El motor usa un bootstrap móvil de retornos logarítmicos en bloques de cinco sesiones. Cada trayectoria selecciona 70% de sus bloques entre los 350 contextos macro-técnicos históricos más próximos, 20% del tramo reciente de tres años y 10% de toda la historia desde 2018.

La similitud se calcula con cambios de 21 sesiones normalizados para USD/MXN, dólar amplio, VIX, WTI y S&P 500, más el diferencial entre la tasa interbancaria mexicana y la tasa efectiva estadounidense. La deriva se contrae entre la muestra completa y la reciente y se limita para evitar extrapolaciones explosivas.

## Limitaciones

- La simulación aprende distribuciones históricas; no conoce decisiones futuras, elecciones, conflictos o sorpresas económicas.
- DEXMXUS es una tasa de compra al mediodía, no una vela negociada.
- El OHLC anterior a septiembre de 2024 no está autorizado por el plan conectado de Massive.
- Las probabilidades simuladas de target y stop usan cierres; el backtest Massive utiliza máximos y mínimos diarios.
- El VIX y el S&P 500 tienen condiciones de redistribución de sus proveedores; aquí se conserva atribución y únicamente los valores necesarios.
- La precisión direccional walk-forward debe interpretarse junto con las bandas: si no supera referencias simples, la mediana no constituye una señal operativa.

## Fuentes

1. Board of Governors of the Federal Reserve System, [Mexican Pesos to U.S. Dollar Spot Exchange Rate (DEXMXUS)](https://fred.stlouisfed.org/series/DEXMXUS), vía FRED.
2. Federal Reserve Bank of New York, [Federal Funds Effective Rate (DFF)](https://fred.stlouisfed.org/series/DFF), vía FRED.
3. Board of Governors of the Federal Reserve System, [Nominal Broad U.S. Dollar Index (DTWEXBGS)](https://fred.stlouisfed.org/series/DTWEXBGS), vía FRED.
4. Chicago Board Options Exchange, [CBOE Volatility Index (VIXCLS)](https://fred.stlouisfed.org/series/VIXCLS), vía FRED.
5. U.S. Energy Information Administration, [WTI Cushing (DCOILWTICO)](https://fred.stlouisfed.org/series/DCOILWTICO), vía FRED.
6. S&P Dow Jones Indices, [S&P 500 (SP500)](https://fred.stlouisfed.org/series/SP500), vía FRED.
7. OECD, [Mexico interbank rate (IRSTCI01MXM156N)](https://fred.stlouisfed.org/series/IRSTCI01MXM156N), vía FRED.
8. U.S. Bureau of Labor Statistics, [Consumer Price Index (CPIAUCSL)](https://fred.stlouisfed.org/series/CPIAUCSL), vía FRED.
9. OECD, [Mexico CPI annual growth (CPALTT01MXM659N)](https://fred.stlouisfed.org/series/CPALTT01MXM659N), vía FRED.
10. Banco de México, [Monetary policy announcements](https://www.banxico.org.mx/publications-and-press/announcements-of-monetary-policy-decisions/monetary-policy-announcements.html).

Este material es educativo y no constituye asesoría financiera ni garantía de resultados.

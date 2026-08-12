import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
from datetime import datetime

semanas = ['2026-05-25','2026-06-01','2026-06-08','2026-06-15','2026-06-22','2026-06-29','2026-07-06','2026-07-13']
mae = [1.573, 1.100, 0.914, 1.113, 0.964, 1.454, 1.008, 1.089]
rmse = [1.961, 1.404, 1.100, 1.353, 1.181, 1.803, 1.317, 1.316]
accuracy = [37.8, 55.6, 58.7, 54.0, 58.7, 41.3, 60.3, 55.6]

dates = [datetime.strptime(d, '%Y-%m-%d') for d in semanas]

fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(12, 8), gridspec_kw={'height_ratios': [2, 1]})
fig.suptitle('Evolucion Semanal del Pronostico', fontsize=14, fontweight='bold')

color_mae = '#e74c3c'
color_rmse = '#e67e22'
color_acc = '#2ecc71'

ax1.plot(dates, mae, 'o-', color=color_mae, linewidth=2, markersize=8, label='MAE (C)')
ax1.plot(dates, rmse, 's--', color=color_rmse, linewidth=2, markersize=7, label='RMSE (C)')
ax1.axhline(y=1.0, color='gray', linestyle=':', alpha=0.5, label='Meta 1C')
ax1.fill_between(dates, mae, alpha=0.1, color=color_mae)
ax1.set_ylabel('Error (C)', fontsize=11)
ax1.legend(loc='upper right', fontsize=10)
ax1.grid(True, alpha=0.2)
ax1.set_ylim(0, 2.5)

for i, (d, v) in enumerate(zip(dates, mae)):
    ax1.annotate(f'{v:.2f}', (d, v), textcoords='offset points', xytext=(0, -14), ha='center', fontsize=8, color=color_mae, fontweight='bold')

# Linear trend line for MAE
import numpy as np
x_num = np.arange(len(dates))
z = np.polyfit(x_num, mae, 1)
p = np.poly1d(z)
ax1.plot(dates, p(x_num), '--', color='#3498db', linewidth=1.5, alpha=0.7, label=f'Tendencia ({z[0]:+.4f}/semana)')
ax1.legend(loc='upper right', fontsize=10)

bars = ax2.bar(dates, accuracy, width=5, color=color_acc, alpha=0.7, label='Acierto +/-1C')
ax2.axhline(y=50, color='gray', linestyle=':', alpha=0.5, label='Linea base 50%')
ax2.set_ylabel('Precision (%)', fontsize=11)
ax2.set_xlabel('Semana', fontsize=11)
ax2.legend(loc='upper left', fontsize=10)
ax2.grid(True, alpha=0.2)
ax2.set_ylim(0, 100)

for bar, v in zip(bars, accuracy):
    ax2.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 1, f'{v:.0f}%', ha='center', fontsize=9, fontweight='bold', color='#27ae60')

for ax in [ax1, ax2]:
    ax.xaxis.set_major_formatter(mdates.DateFormatter('%d/%m'))
    ax.xaxis.set_major_locator(mdates.WeekdayLocator(interval=1))
    ax.tick_params(axis='x', rotation=45)

plt.tight_layout()
plt.savefig('static/evolucion-semanal.png', dpi=150, bbox_inches='tight')
print('Grafico guardado: static/evolucion-semanal.png')

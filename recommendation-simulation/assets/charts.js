(function() {
  var style = getComputedStyle(document.documentElement);
  var accent = style.getPropertyValue('--accent').trim();
  var accent2 = style.getPropertyValue('--accent2').trim();
  var ink = style.getPropertyValue('--ink').trim();
  var muted = style.getPropertyValue('--muted').trim();
  var rule = style.getPropertyValue('--rule').trim();
  var bg2 = style.getPropertyValue('--bg2').trim();

  var strategies = ['balanced', 'review_first', 'learn_first', 'consolidate'];
  var strategyNames = { balanced: '平衡', review_first: '复习优先', learn_first: '学习优先', consolidate: '巩固优先' };

  // --- Chart 1: Strategy Comparison Bar ---
  var chart1 = echarts.init(document.getElementById('chart-strategy-compare'), null, { renderer: 'svg' });
  chart1.setOption({
    animation: false,
    color: [accent, accent2, accent + '99', accent2 + '99'],
    tooltip: { trigger: 'axis', appendToBody: true },
    legend: { bottom: 0, textStyle: { color: muted } },
    grid: { left: '3%', right: '4%', bottom: '15%', top: '10%', containLabel: true },
    xAxis: {
      type: 'category',
      data: ['平衡', '复习优先', '学习优先', '巩固优先'],
      axisLabel: { color: muted },
      axisLine: { lineStyle: { color: rule } }
    },
    yAxis: {
      type: 'value',
      name: '评分',
      axisLabel: { color: muted },
      axisLine: { lineStyle: { color: rule } },
      splitLine: { lineStyle: { color: rule } }
    },
    series: [
      {
        name: '平均分',
        type: 'bar',
        data: [786.2, 849.8, 579.7, 480.6],
        itemStyle: { borderRadius: [4, 4, 0, 0] }
      },
      {
        name: '中位数',
        type: 'bar',
        data: [783.8, 846.0, 578.6, 480.0],
        itemStyle: { borderRadius: [4, 4, 0, 0] }
      }
    ]
  });
  window.addEventListener('resize', function() { chart1.resize(); });

  // --- Chart 2: Score Distribution Box Plot ---
  var chart2 = echarts.init(document.getElementById('chart-score-dist'), null, { renderer: 'svg' });
  chart2.setOption({
    animation: false,
    color: [accent, accent2, accent + '99', accent2 + '99'],
    tooltip: { trigger: 'axis', appendToBody: true },
    grid: { left: '3%', right: '4%', bottom: '10%', top: '10%', containLabel: true },
    xAxis: {
      type: 'category',
      data: ['平衡', '复习优先', '学习优先', '巩固优先'],
      axisLabel: { color: muted },
      axisLine: { lineStyle: { color: rule } }
    },
    yAxis: {
      type: 'value',
      name: 'Top1 评分',
      axisLabel: { color: muted },
      axisLine: { lineStyle: { color: rule } },
      splitLine: { lineStyle: { color: rule } }
    },
    series: [
      {
        name: '最小值',
        type: 'bar',
        stack: 'range',
        data: [654, 649.5, 485.1, 377],
        itemStyle: { color: 'transparent', borderColor: 'transparent' }
      },
      {
        name: 'P25-P75',
        type: 'bar',
        stack: 'range',
        data: [755.7 - 654, 810.15 - 649.5, 554.4 - 485.1, 458 - 377],
        itemStyle: { color: muted + '44', borderColor: 'transparent', borderRadius: [0, 0, 0, 0] }
      },
      {
        name: 'IQR',
        type: 'bar',
        stack: 'range',
        data: [815.1 - 755.7, 889.35 - 810.15, 601 - 554.4, 502.7 - 458],
        itemStyle: { color: accent, borderRadius: [4, 4, 0, 0] }
      },
      {
        name: 'P75-Max',
        type: 'bar',
        stack: 'range',
        data: [940.5 - 815.1, 1067.55 - 889.35, 702.9 - 601, 588.5 - 502.7],
        itemStyle: { color: accent + '55', borderColor: 'transparent', borderRadius: [0, 0, 0, 0] }
      }
    ]
  });
  window.addEventListener('resize', function() { chart2.resize(); });

  // --- Chart 3: Score Range Comparison ---
  var chart3 = echarts.init(document.getElementById('chart-score-range'), null, { renderer: 'svg' });
  chart3.setOption({
    animation: false,
    color: [accent, accent2, accent + '99', accent2 + '99'],
    tooltip: { trigger: 'axis', appendToBody: true },
    legend: { bottom: 0, textStyle: { color: muted } },
    grid: { left: '3%', right: '4%', bottom: '15%', top: '10%', containLabel: true },
    xAxis: {
      type: 'category',
      data: ['平衡', '复习优先', '学习优先', '巩固优先'],
      axisLabel: { color: muted },
      axisLine: { lineStyle: { color: rule } }
    },
    yAxis: {
      type: 'value',
      name: '评分',
      axisLabel: { color: muted },
      axisLine: { lineStyle: { color: rule } },
      splitLine: { lineStyle: { color: rule } }
    },
    series: [
      {
        name: '最低分',
        type: 'bar',
        data: [654, 649.5, 485.1, 377],
        itemStyle: { borderRadius: [4, 4, 0, 0] }
      },
      {
        name: '最高分',
        type: 'bar',
        data: [940.5, 1067.6, 702.9, 588.5],
        itemStyle: { borderRadius: [4, 4, 0, 0] }
      }
    ]
  });
  window.addEventListener('resize', function() { chart3.resize(); });

  // --- Chart 4: Due Word Count per Strategy ---
  var chart4 = echarts.init(document.getElementById('chart-due-words'), null, { renderer: 'svg' });
  chart4.setOption({
    animation: false,
    color: [accent, accent2],
    tooltip: { trigger: 'axis', appendToBody: true },
    legend: { bottom: 0, textStyle: { color: muted } },
    grid: { left: '3%', right: '4%', bottom: '15%', top: '10%', containLabel: true },
    xAxis: {
      type: 'category',
      data: ['平衡', '复习优先', '学习优先', '巩固优先'],
      axisLabel: { color: muted },
      axisLine: { lineStyle: { color: rule } }
    },
    yAxis: [
      {
        type: 'value',
        name: '平均到期词数',
        axisLabel: { color: muted },
        axisLine: { lineStyle: { color: rule } },
        splitLine: { lineStyle: { color: rule } }
      },
      {
        type: 'value',
        name: '平均学习区词数',
        axisLabel: { color: muted },
        axisLine: { lineStyle: { color: rule } },
        splitLine: { show: false }
      }
    ],
    series: [
      {
        name: '平均到期词数',
        type: 'bar',
        data: [22.7, 23.1, 22.0, 22.3],
        itemStyle: { borderRadius: [4, 4, 0, 0] }
      },
      {
        name: '平均学习区词数',
        type: 'bar',
        yAxisIndex: 1,
        data: [87.5, 86.5, 88.8, 85.2],
        itemStyle: { borderRadius: [4, 4, 0, 0] }
      }
    ]
  });
  window.addEventListener('resize', function() { chart4.resize(); });
})();
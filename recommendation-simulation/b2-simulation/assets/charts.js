// assets/charts.js
(function() {
  var style = getComputedStyle(document.documentElement);
  var accent = style.getPropertyValue('--accent').trim() || '#2563EB';
  var accent2 = style.getPropertyValue('--accent2').trim() || '#7C3AED';
  var ink = style.getPropertyValue('--ink').trim() || '#1E1B18';
  var muted = style.getPropertyValue('--muted').trim() || '#7A7265';
  var rule = style.getPropertyValue('--rule').trim() || '#D8D3C8';
  var bg2 = style.getPropertyValue('--bg2').trim() || '#EFECE3';

  // --- Chart 1: Strategy Comparison ---
  var chart1 = echarts.init(document.getElementById('chart-strategy-compare'), null, { renderer: 'svg' });
  chart1.setOption({
    animation: false,
    color: [accent, accent2, accent + '99', accent2 + '99'],
    tooltip: { trigger: 'axis', appendToBody: true },
    legend: {
      data: ['阅读文章数', '新增词汇', '推荐平均分(÷1000)'],
      bottom: 0,
      textStyle: { color: muted }
    },
    grid: { left: '3%', right: '4%', bottom: '15%', top: '10%', containLabel: true },
    xAxis: {
      type: 'category',
      data: ['balanced', 'review_first', 'learn_first', 'consolidate'],
      axisLabel: { color: muted },
      axisLine: { lineStyle: { color: rule } }
    },
    yAxis: [
      {
        type: 'value',
        name: '数量',
        axisLabel: { color: muted },
        axisLine: { lineStyle: { color: rule } },
        splitLine: { lineStyle: { color: rule } }
      },
      {
        type: 'value',
        name: '评分(÷1000)',
        axisLabel: { color: muted },
        axisLine: { lineStyle: { color: rule } },
        splitLine: { show: false }
      }
    ],
    series: [
      {
        name: '阅读文章数',
        type: 'bar',
        data: [8, 11, 0, 0],
        itemStyle: { borderRadius: [4, 4, 0, 0] }
      },
      {
        name: '新增词汇',
        type: 'bar',
        data: [1310, 1603, 0, 0],
        itemStyle: { borderRadius: [4, 4, 0, 0] }
      },
      {
        name: '推荐平均分(÷1000)',
        type: 'line',
        yAxisIndex: 1,
        data: [16.06, 0, 0, 0],
        lineStyle: { color: accent2, width: 2 },
        itemStyle: { color: accent2 },
        symbol: 'circle',
        symbolSize: 8
      }
    ]
  });
  window.addEventListener('resize', function() { chart1.resize(); });

  // --- Chart 2: Level Distribution (Before/After) ---
  var chart2 = echarts.init(document.getElementById('chart-level-dist'), null, { renderer: 'svg' });
  chart2.setOption({
    animation: false,
    color: [accent, accent2],
    tooltip: { trigger: 'axis', appendToBody: true },
    legend: {
      data: ['初始状态', '2000次迭代后'],
      bottom: 0,
      textStyle: { color: muted }
    },
    grid: { left: '3%', right: '4%', bottom: '15%', top: '10%', containLabel: true },
    xAxis: {
      type: 'category',
      data: ['L0\n无证据', 'L1\n依赖帮助', 'L2\n形成识别', 'L3\n多数识别', 'L4\n稳定识别'],
      axisLabel: { color: muted, fontSize: 11 },
      axisLine: { lineStyle: { color: rule } }
    },
    yAxis: {
      type: 'value',
      name: '词汇数量',
      axisLabel: { color: muted },
      axisLine: { lineStyle: { color: rule } },
      splitLine: { lineStyle: { color: rule } }
    },
    series: [
      {
        name: '初始状态',
        type: 'bar',
        data: [993, 16683, 3468, 771, 35],
        itemStyle: { borderRadius: [4, 4, 0, 0] }
      },
      {
        name: '2000次迭代后',
        type: 'bar',
        data: [19133, 1, 0, 0, 4126],
        itemStyle: { borderRadius: [4, 4, 0, 0] }
      }
    ]
  });
  window.addEventListener('resize', function() { chart2.resize(); });

  // --- Chart 3: Article Accessibility Distribution ---
  var chart3 = echarts.init(document.getElementById('chart-accessibility'), null, { renderer: 'svg' });
  
  // Simulated data: distribution of unknown word ratio across 658 articles for B2 user
  // Since B2 user knows 55% of words, most C1 articles have >30% unknown ratio
  var buckets = [
    { range: '0-10%', count: 0 },
    { range: '10-20%', count: 0 },
    { range: '20-30%', count: 3 },
    { range: '30-40%', count: 18 },
    { range: '40-50%', count: 95 },
    { range: '50-60%', count: 210 },
    { range: '60-70%', count: 198 },
    { range: '70-80%', count: 102 },
    { range: '80-90%', count: 29 },
    { range: '90-100%', count: 3 },
  ];

  chart3.setOption({
    animation: false,
    color: [accent],
    tooltip: {
      trigger: 'axis',
      appendToBody: true,
      formatter: function(params) {
        var d = params[0];
        return d.name + '<br/>文章数: <b>' + d.value + '</b>';
      }
    },
    grid: { left: '3%', right: '4%', bottom: '10%', top: '10%', containLabel: true },
    xAxis: {
      type: 'category',
      data: buckets.map(function(b) { return b.range; }),
      name: '未知词比例',
      axisLabel: { color: muted, fontSize: 11 },
      axisLine: { lineStyle: { color: rule } }
    },
    yAxis: {
      type: 'value',
      name: '文章数量',
      axisLabel: { color: muted },
      axisLine: { lineStyle: { color: rule } },
      splitLine: { lineStyle: { color: rule } }
    },
    series: [
      {
        type: 'bar',
        data: buckets.map(function(b) { return b.count; }),
        itemStyle: {
          borderRadius: [4, 4, 0, 0],
          color: function(params) {
            // Highlight bars that pass the filter (0-30%)
            var idx = params.dataIndex;
            return idx < 3 ? accent2 : accent;
          }
        },
        markLine: {
          silent: true,
          symbol: 'none',
          lineStyle: { color: '#EF4444', type: 'dashed', width: 2 },
          label: {
            formatter: '30% 过滤阈值',
            color: '#EF4444',
            fontSize: 12,
            position: 'start'
          },
          data: [{ xAxis: '20-30%' }]
        }
      }
    ]
  });
  window.addEventListener('resize', function() { chart3.resize(); });

})();
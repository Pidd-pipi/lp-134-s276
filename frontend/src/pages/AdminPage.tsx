import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { counselorAPI, crisisAPI } from '../services/api';
import { CrisisAlert, CrisisAlertStatus } from '../types';
import { useAuth } from '../context/AuthContext';

const STATUS_META: Record<CrisisAlertStatus, { label: string; className: string }> = {
  PENDING: { label: '待处理', className: 'bg-red-100 text-red-700' },
  FOLLOWING: { label: '跟进中', className: 'bg-yellow-100 text-yellow-700' },
  CLOSED: { label: '已关闭', className: 'bg-green-100 text-green-700' },
  FALSE_ALARM: { label: '误报', className: 'bg-gray-100 text-gray-600' }
};

const STATUS_FILTERS: { value: CrisisAlertStatus | ''; label: string }[] = [
  { value: '', label: '全部' },
  { value: 'PENDING', label: '待处理' },
  { value: 'FOLLOWING', label: '跟进中' },
  { value: 'CLOSED', label: '已关闭' },
  { value: 'FALSE_ALARM', label: '误报' }
];

const AdminPage: React.FC = () => {
  const { user, isLoading } = useAuth();
  const [activeTab, setActiveTab] = useState('counselors');
  const [pendingCounselors, setPendingCounselors] = useState<any[]>([]);
  const [alerts, setAlerts] = useState<CrisisAlert[]>([]);
  const [selectedAlert, setSelectedAlert] = useState<CrisisAlert | null>(null);
  const [statusFilter, setStatusFilter] = useState<CrisisAlertStatus | ''>('');

  const fetchAlerts = async (status: CrisisAlertStatus | '' = statusFilter) => {
    const res = await crisisAPI.getAlerts(status ? { status } : undefined);
    const list = res.data.alerts || res.data;
    setAlerts(list);
    return list as CrisisAlert[];
  };

  useEffect(() => {
    if (!user || user.role !== 'ADMIN') return;

    const fetchData = async () => {
      try {
        const [counselorsRes] = await Promise.all([
          counselorAPI.getPending()
        ]);
        setPendingCounselors(counselorsRes.data);
        await fetchAlerts();
      } catch (error) {
        console.error('获取管理数据失败:', error);
      }
    };
    fetchData();
  }, [user]);

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-8 text-center">
        <div className="text-gray-500">加载中...</div>
      </div>
    );
  }

  if (!user || user.role !== 'ADMIN') {
    return <Navigate to="/" />;
  }

  const handleReviewCounselor = async (id: string, status: 'APPROVED' | 'REJECTED') => {
    const rejectionReason = status === 'REJECTED'
      ? prompt('请输入拒绝原因（选填）') || undefined
      : undefined;

    try {
      await counselorAPI.reviewCounselor(id, { status, rejectionReason });
      alert('审核完成');
      const res = await counselorAPI.getPending();
      setPendingCounselors(res.data);
    } catch (error) {
      alert('审核失败');
    }
  };

  const handleFilterChange = async (status: CrisisAlertStatus | '') => {
    setStatusFilter(status);
    setSelectedAlert(null);
    try {
      await fetchAlerts(status);
    } catch (error) {
      alert('获取预警列表失败');
    }
  };

  // 操作失败后回读最新列表，保证并发冲突时页面状态与后端一致
  const refreshAfterAction = async (updated?: CrisisAlert) => {
    const list = await fetchAlerts();
    if (updated) {
      const fresh = list.find(a => a.id === updated.id);
      setSelectedAlert(fresh || null);
    } else {
      setSelectedAlert(null);
    }
  };

  const handleClaimAlert = async (target: CrisisAlert) => {
    const note = prompt('请填写干预备注（选填）') ?? undefined;
    try {
      const res = await crisisAPI.claimAlert(target.id, note ? { note } : undefined);
      alert('已领取，状态更新为跟进中');
      await refreshAfterAction(res.data.alert);
    } catch (error: any) {
      alert(error.response?.data?.error || '领取失败，该预警可能已被其他管理员领取');
      await refreshAfterAction();
    }
  };

  const handleResolveAlert = async (target: CrisisAlert) => {
    const note = prompt('请填写关闭说明（必填）');
    if (!note || !note.trim()) {
      alert('关闭说明必须填写，操作已取消');
      return;
    }
    try {
      const res = await crisisAPI.resolveAlert(target.id, { note: note.trim() });
      alert('预警已关闭');
      await refreshAfterAction(res.data.alert);
    } catch (error: any) {
      alert(error.response?.data?.error || '关闭失败，只有跟进中的预警才能关闭');
      await refreshAfterAction();
    }
  };

  const handleFalseAlarm = async (target: CrisisAlert) => {
    const note = prompt('请填写误报说明（选填）') ?? undefined;
    try {
      const res = await crisisAPI.markFalseAlarm(target.id, note ? { note } : undefined);
      alert('已标记为误报');
      await refreshAfterAction(res.data.alert);
    } catch (error: any) {
      alert(error.response?.data?.error || '操作失败，该预警可能已被处理');
      await refreshAfterAction();
    }
  };

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold text-gray-800 mb-8">管理后台</h1>

      <div className="bg-white rounded-lg shadow-md overflow-hidden mb-8">
        <div className="border-b">
          <div className="flex">
            <button
              onClick={() => setActiveTab('counselors')}
              className={`px-6 py-4 text-sm font-medium transition-colors ${
                activeTab === 'counselors'
                  ? 'text-primary-600 border-b-2 border-primary-600 bg-primary-50'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
              }`}
            >
              咨询师审核 ({pendingCounselors.length})
            </button>
            <button
              onClick={() => setActiveTab('alerts')}
              className={`px-6 py-4 text-sm font-medium transition-colors ${
                activeTab === 'alerts'
                  ? 'text-primary-600 border-b-2 border-primary-600 bg-primary-50'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
              }`}
            >
              危机预警 ({alerts.length})
            </button>
          </div>
        </div>

        <div className="p-6">
          {activeTab === 'counselors' && (
            <div className="space-y-4">
              {pendingCounselors.length === 0 ? (
                <div className="text-center py-12 text-gray-500">
                  <div className="text-4xl mb-4">✅</div>
                  <p>暂无待审核的咨询师申请</p>
                </div>
              ) : (
                pendingCounselors.map(counselor => (
                  <div key={counselor.id} className="border rounded-lg p-4">
                    <div className="flex justify-between items-start mb-4">
                      <div>
                        <h3 className="font-semibold text-gray-800">
                          {counselor.user.nickname || counselor.user.username}
                        </h3>
                        <p className="text-sm text-gray-500">
                          真实姓名：{counselor.realName}
                        </p>
                        <p className="text-sm text-gray-500">
                          证书编号：{counselor.certificateNumber}
                        </p>
                        <p className="text-sm text-gray-500">
                          咨询费用：¥{counselor.hourlyRate}/小时
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleReviewCounselor(counselor.id, 'APPROVED')}
                          className="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600"
                        >
                          通过
                        </button>
                        <button
                          onClick={() => handleReviewCounselor(counselor.id, 'REJECTED')}
                          className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600"
                        >
                          拒绝
                        </button>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 mb-3">
                      {counselor.expertise?.map((tag: string, i: number) => (
                        <span key={i} className="px-2 py-1 bg-blue-100 text-blue-700 text-xs rounded-full">
                          {tag}
                        </span>
                      ))}
                    </div>
                    {counselor.introduction && (
                      <p className="text-sm text-gray-600">{counselor.introduction}</p>
                    )}
                    <p className="text-xs text-gray-400 mt-3">
                      申请时间：{new Date(counselor.createdAt).toLocaleString()}
                    </p>
                  </div>
                ))
              )}
            </div>
          )}

          {activeTab === 'alerts' && (
            <div>
              <div className="flex gap-2 mb-4">
                {STATUS_FILTERS.map(filter => (
                  <button
                    key={filter.value}
                    onClick={() => handleFilterChange(filter.value)}
                    className={`px-3 py-1.5 text-sm rounded-full transition-colors ${
                      statusFilter === filter.value
                        ? 'bg-primary-600 text-white'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {filter.label}
                  </button>
                ))}
              </div>

              <div className="grid md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  {alerts.length === 0 ? (
                    <div className="text-center py-12 text-gray-500">
                      <div className="text-4xl mb-4">✅</div>
                      <p>暂无危机预警</p>
                    </div>
                  ) : (
                    alerts.map(alert => (
                      <div
                        key={alert.id}
                        onClick={() => setSelectedAlert(alert)}
                        className={`border rounded-lg p-4 cursor-pointer transition-colors ${
                          selectedAlert?.id === alert.id
                            ? 'border-primary-500 bg-primary-50'
                            : 'hover:bg-gray-50'
                        }`}
                      >
                        <div className="flex items-center gap-3 mb-2">
                          <span className="text-red-500 text-xl">⚠️</span>
                          <div className="flex-1">
                            <p className="font-medium text-gray-800">
                              {alert.user.nickname || alert.user.username}
                            </p>
                            <p className="text-xs text-gray-500">
                              {new Date(alert.createdAt).toLocaleString()}
                            </p>
                          </div>
                          <span className={`px-2 py-1 text-xs rounded-full ${STATUS_META[alert.status].className}`}>
                            {STATUS_META[alert.status].label}
                          </span>
                        </div>
                        <p className="text-sm text-gray-600">
                          检测到关键词：{alert.keyword}
                        </p>
                        {alert.claimedByUser && (
                          <p className="text-xs text-gray-500 mt-1">
                            跟进人：{alert.claimedByUser.nickname || alert.claimedByUser.username}
                          </p>
                        )}
                      </div>
                    ))
                  )}
                </div>

                <div>
                  {selectedAlert ? (
                    <div className="border rounded-lg p-4">
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="font-semibold text-lg">预警详情</h3>
                        <span className={`px-2 py-1 text-xs rounded-full ${STATUS_META[selectedAlert.status].className}`}>
                          {STATUS_META[selectedAlert.status].label}
                        </span>
                      </div>
                      <div className="space-y-3">
                        <div>
                          <p className="text-sm text-gray-500">用户</p>
                          <p className="font-medium">
                            {selectedAlert.user.nickname || selectedAlert.user.username}
                          </p>
                          <p className="text-sm text-gray-500">{selectedAlert.user.email}</p>
                        </div>
                        <div>
                          <p className="text-sm text-gray-500">检测到的关键词</p>
                          <p className="font-medium text-red-600">{selectedAlert.keyword}</p>
                        </div>
                        <div>
                          <p className="text-sm text-gray-500">内容摘要</p>
                          <p className="text-gray-700 bg-gray-50 p-3 rounded">
                            {selectedAlert.content}
                          </p>
                        </div>
                        <div>
                          <p className="text-sm text-gray-500">检测时间</p>
                          <p>{new Date(selectedAlert.createdAt).toLocaleString()}</p>
                        </div>
                        {selectedAlert.claimedByUser && (
                          <div>
                            <p className="text-sm text-gray-500">跟进人</p>
                            <p className="font-medium">
                              {selectedAlert.claimedByUser.nickname || selectedAlert.claimedByUser.username}
                            </p>
                            {selectedAlert.claimedAt && (
                              <p className="text-xs text-gray-400">
                                领取时间：{new Date(selectedAlert.claimedAt).toLocaleString()}
                              </p>
                            )}
                          </div>
                        )}
                        {selectedAlert.interventionNote && (
                          <div>
                            <p className="text-sm text-gray-500">干预备注</p>
                            <p className="text-gray-700 bg-yellow-50 p-3 rounded">
                              {selectedAlert.interventionNote}
                            </p>
                          </div>
                        )}
                        {selectedAlert.resolutionNote && (
                          <div>
                            <p className="text-sm text-gray-500">处理说明</p>
                            <p className="text-gray-700 bg-green-50 p-3 rounded">
                              {selectedAlert.resolutionNote}
                            </p>
                            {selectedAlert.resolvedAt && (
                              <p className="text-xs text-gray-400 mt-1">
                                处理时间：{new Date(selectedAlert.resolvedAt).toLocaleString()}
                              </p>
                            )}
                          </div>
                        )}
                      </div>

                      {selectedAlert.status === 'PENDING' && (
                        <div className="flex gap-2 mt-6">
                          <button
                            onClick={() => handleClaimAlert(selectedAlert)}
                            className="flex-1 btn-primary"
                          >
                            领取并跟进
                          </button>
                          <button
                            onClick={() => handleFalseAlarm(selectedAlert)}
                            className="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
                          >
                            标记误报
                          </button>
                        </div>
                      )}
                      {selectedAlert.status === 'FOLLOWING' && (
                        <div className="flex gap-2 mt-6">
                          <button
                            onClick={() => handleResolveAlert(selectedAlert)}
                            className="flex-1 btn-primary"
                          >
                            关闭预警
                          </button>
                          <button
                            onClick={() => handleFalseAlarm(selectedAlert)}
                            className="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
                          >
                            标记误报
                          </button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="border-2 border-dashed border-gray-200 rounded-lg p-8 text-center text-gray-500">
                      <div className="text-4xl mb-4">👈</div>
                      <p>点击左侧查看预警详情</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AdminPage;

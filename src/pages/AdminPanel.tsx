import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import axios from "axios";
import { 
  Users, Plus, Edit2, Trash2, Search, X, 
  Filter, Download, RefreshCw,
  ChevronLeft, ChevronRight, AlertCircle,
  CheckCircle, XCircle, Loader, CalendarDays, UserCheck
} from "lucide-react";
import { useAuthStore } from "../store/authStore";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import Chatbot from "../components/Chatbot";
import Navbar from "../components/Navbar";
import TimetableUpload from "../components/TimetableUpload";
import MentorUpload from "../components/MentorUpload";

interface StudentForm {
  name: string;
  email: string;
  rollNo: string;
  department: string;
  year: string;
  fatherName: string;
  motherName: string;
  contactNumber: string;
  address: string;
  dateOfBirth: string;
  gender: string;
  status: string;
  photo: string;
  collegeIdCard: string;
}

interface FormErrors {
  name?: string;
  email?: string;
  rollNo?: string;
  department?: string;
  year?: string;
  fatherName?: string;
  motherName?: string;
  contactNumber?: string;
  [key: string]: string | undefined;
}

interface Student {
  _id: string;
  name: string;
  email: string;
  rollNo: string;
  department: string;
  year: string;
  fatherName: string;
  motherName: string;
  contactNumber: string;
  address?: string;
  dateOfBirth?: string;
  gender?: string;
  status: string;
  photo?: string;
  collegeIdCard?: string;
}

export default function AdminPanel() {
  const navigate = useNavigate();
  
  // State Management
  const [students, setStudents] = useState<Student[]>([]);
  const [filteredStudents, setFilteredStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState("ALL");
  const [showModal, setShowModal] = useState(false);
  const [modalMode, setModalMode] = useState<"add" | "edit">("add");
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [studentToDelete, setStudentToDelete] = useState<Student | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  
  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [studentsPerPage] = useState(10);
  
  // Form State
  const [form, setForm] = useState<StudentForm>({
    name: "",
    email: "",
    rollNo: "",
    department: "",
    year: "",
    fatherName: "",
    motherName: "",
    contactNumber: "",
    address: "",
    dateOfBirth: "",
    gender: "",
    status: "ACTIVE",
    photo: "",
    collegeIdCard: ""
  });

  const [formErrors, setFormErrors] = useState<FormErrors>({});
  const [stats, setStats] = useState({
    total: 0,
    active: 0,
    inactive: 0,
    suspended: 0
  });

  // API Base URL
  const API_URL = `${import.meta.env.VITE_AUTH_URL}/api/students`;

  // Fetch Students
  const fetchStudents = async () => {
    setLoading(true);
    try {
      const res = await axios.get(API_URL, { withCredentials: true });
      setStudents(res.data);
      setFilteredStudents(res.data);
      calculateStats(res.data);
      toast.success("Students loaded successfully");
    } catch (err) {
      console.error("Error fetching students:", err);
      toast.error(err.response?.data?.message || "Failed to fetch students");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStudents();
  }, []);

  // Calculate Statistics
  const calculateStats = (data: Student[]) => {
    setStats({
      total: data.length,
      active: data.filter(s => s.status === 'ACTIVE').length,
      inactive: data.filter(s => s.status === 'INACTIVE').length,
      suspended: data.filter(s => s.status === 'SUSPENDED').length
    });
  };

  // Search and Filter
  useEffect(() => {
    let result = students;

    // Search
    if (searchTerm) {
      result = result.filter(student =>
        student.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        student.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        student.rollNo?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        student.department?.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    // Filter by status
    if (filterStatus !== "ALL") {
      result = result.filter(student => student.status === filterStatus);
    }

    setFilteredStudents(result);
    setCurrentPage(1);
  }, [searchTerm, filterStatus, students]);

  // Pagination
  const indexOfLastStudent = currentPage * studentsPerPage;
  const indexOfFirstStudent = indexOfLastStudent - studentsPerPage;
  const currentStudents = filteredStudents.slice(indexOfFirstStudent, indexOfLastStudent);
  const totalPages = Math.ceil(filteredStudents.length / studentsPerPage);

  // Form Validation
  const validateForm = () => {
    const errors: FormErrors = {};

    if (!form.name.trim()) errors.name = "Name is required";
    if (!form.email.trim()) errors.email = "Email is required";
    else if (!form.email.endsWith('@gdgu.org')) errors.email = "Must be a GDGU email (@gdgu.org)";
    if (!form.rollNo.trim()) errors.rollNo = "Roll number is required";
    if (!form.department.trim()) errors.department = "Department is required";
    if (!form.year) errors.year = "Year is required";
    if (!form.fatherName.trim()) errors.fatherName = "Father's name is required";
    if (!form.motherName.trim()) errors.motherName = "Mother's name is required";
    if (!form.contactNumber.trim()) errors.contactNumber = "Contact number is required";
    else if (!/^[0-9]{10}$/.test(form.contactNumber)) errors.contactNumber = "Must be 10 digits";

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // Add/Update Student
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validateForm()) {
      toast.error("Please fix all errors");
      return;
    }

    setLoading(true);
    try {
      // Prepare data with optional fields
      const studentData = {
        ...form,
        photo: form.photo || "",
        collegeIdCard: form.collegeIdCard || ""
      };

      console.log("Submitting student data:", studentData); // Debug log

      if (modalMode === "edit" && selectedStudent) {
        const response = await axios.put(`${API_URL}/${selectedStudent._id}`, studentData, { withCredentials: true });
        console.log("Update response:", response.data);
        toast.success("Student updated successfully!");
      } else {
        const response = await axios.post(API_URL, studentData, { withCredentials: true });
        console.log("Add response:", response.data);
        toast.success("Student added successfully!");
      }
      
      resetForm();
      setShowModal(false);
      fetchStudents();
    } catch (err: any) {
      console.error("Full error:", err);
      console.error("Error response:", err.response?.data);
      const errorMessage = err.response?.data?.message || err.response?.data?.error || "Operation failed";
      toast.error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  // Delete Student
  const handleDelete = async () => {
    if (!studentToDelete) return;

    setLoading(true);
    try {
      await axios.delete(`${API_URL}/${studentToDelete._id}`, { withCredentials: true });
      toast.success("Student deleted successfully!");
      setShowDeleteConfirm(false);
      setStudentToDelete(null);
      fetchStudents();
    } catch (err) {
      console.error(err);
      toast.error(err.response?.data?.message || "Delete failed");
    } finally {
      setLoading(false);
    }
  };

  // Open Add Modal
  const openAddModal = () => {
    resetForm();
    setModalMode("add");
    setShowModal(true);
  };

  // Open Edit Modal
  const openEditModal = (student: Student) => {
    setSelectedStudent(student);
    setForm({
      name: student.name || "",
      email: student.email || "",
      rollNo: student.rollNo || "",
      department: student.department || "",
      year: student.year || "",
      fatherName: student.fatherName || "",
      motherName: student.motherName || "",
      contactNumber: student.contactNumber || "",
      address: student.address || "",
      dateOfBirth: student.dateOfBirth ? student.dateOfBirth.split('T')[0] : "",
      gender: student.gender || "",
      status: student.status || "ACTIVE",
      photo: student.photo || "",
      collegeIdCard: student.collegeIdCard || ""
    });
    setModalMode("edit");
    setShowModal(true);
  };

  // Open Delete Confirmation
  const openDeleteConfirm = (student: Student) => {
    setStudentToDelete(student);
    setShowDeleteConfirm(true);
  };

  // Reset Form
  const resetForm = () => {
    setForm({
      name: "",
      email: "",
      rollNo: "",
      department: "",
      year: "",
      fatherName: "",
      motherName: "",
      contactNumber: "",
      address: "",
      dateOfBirth: "",
      gender: "",
      status: "ACTIVE",
      photo: "",
      collegeIdCard: ""
    });
    setFormErrors({});
    setSelectedStudent(null);
  };

  // Export to CSV
  const exportToCSV = () => {
    const headers = ["Roll No", "Name", "Email", "Department", "Year", "Contact", "Father's Name", "Mother's Name", "Status"];
    const csvData = filteredStudents.map(s => [
      s.rollNo, s.name, s.email, s.department, s.year, 
      s.contactNumber, s.fatherName, s.motherName, s.status
    ]);
    
    const csv = [headers, ...csvData].map(row => row.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `students_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    toast.success("Exported successfully!");
  };

  const [activeTab, setActiveTab] = useState<"students" | "timetable" | "mentor">("students");

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
      <Navbar />
      
      <div className="pt-24 px-6 pb-6">
        <div className="max-w-7xl mx-auto">

        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-slate-900/95 backdrop-blur-xl rounded-2xl border border-slate-800 p-6 mb-6 shadow-2xl"
        >
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-400 via-purple-400 to-indigo-400 text-transparent bg-clip-text mb-2">
                Admin Panel
              </h1>
              <p className="text-slate-400 text-sm">Manage student records and information</p>
            </div>
            {/* Tab switcher */}
            <div className="flex gap-2 bg-slate-800 p-1 rounded-xl">
              <button
                onClick={() => setActiveTab("students")}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === "students" ? "bg-blue-600 text-white" : "text-slate-400 hover:text-white"}`}
              >
                <Users size={15} /> Students
              </button>
              <button
                onClick={() => setActiveTab("timetable")}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === "timetable" ? "bg-purple-600 text-white" : "text-slate-400 hover:text-white"}`}
              >
                <CalendarDays size={15} /> Timetable
              </button>
              <button
                onClick={() => setActiveTab("mentor")}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === "mentor" ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-white"}`}
              >
                <UserCheck size={15} /> Mentor-Mentee
              </button>
            </div>
          </div>
        </motion.div>

        {/* Timetable Tab */}
        {activeTab === "timetable" && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
            className="bg-slate-900/95 backdrop-blur-xl rounded-2xl border border-slate-800 p-6 shadow-2xl">
            <h2 className="text-xl font-semibold text-white mb-4">Upload Timetable PDF</h2>
            <p className="text-slate-400 text-sm mb-6">Upload a GD Goenka University timetable PDF to extract structured JSON data.</p>
            <TimetableUpload />
          </motion.div>
        )}

        {/* Mentor-Mentee Tab */}
        {activeTab === "mentor" && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
            className="bg-slate-900/95 backdrop-blur-xl rounded-2xl border border-slate-800 p-6 shadow-2xl">
            <h2 className="text-xl font-semibold text-white mb-2">Upload Mentor-Mentee Data</h2>
            <p className="text-slate-400 text-sm mb-6">
              Upload the mentor-mentee allocation Excel sheet. Students can then query their mentor details via the chatbot.
            </p>
            <MentorUpload />
          </motion.div>
        )}

        {/* Students Tab */}
        {activeTab === "students" && (<div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          {[
            { label: "Total Students", value: stats.total, color: "from-blue-600 to-blue-700", icon: Users },
            { label: "Active", value: stats.active, color: "from-green-600 to-green-700", icon: CheckCircle },
            { label: "Inactive", value: stats.inactive, color: "from-yellow-600 to-yellow-700", icon: AlertCircle },
            { label: "Suspended", value: stats.suspended, color: "from-red-600 to-red-700", icon: XCircle }
          ].map((stat, index) => (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
              className="bg-slate-900/95 backdrop-blur-xl rounded-xl border border-slate-800 p-6 shadow-xl"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-slate-400 text-sm mb-1">{stat.label}</p>
                  <p className="text-3xl font-bold text-white">{stat.value}</p>
                </div>
                <div className={`p-3 bg-gradient-to-br ${stat.color} rounded-lg`}>
                  <stat.icon className="w-6 h-6 text-white" />
                </div>
              </div>
            </motion.div>
          ))}
        </div>

        {/* Controls */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-slate-900/95 backdrop-blur-xl rounded-2xl border border-slate-800 p-6 mb-6 shadow-2xl"
        >
          <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
            {/* Search */}
            <div className="relative flex-1 w-full md:w-auto">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-5 h-5" />
              <input
                type="text"
                placeholder="Search by name, email, roll no, or department..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all"
              />
            </div>

            {/* Filter */}
            <div className="flex items-center gap-2">
              <Filter className="text-slate-400 w-5 h-5" />
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all"
              >
                <option value="ALL">All Status</option>
                <option value="ACTIVE">Active</option>
                <option value="INACTIVE">Inactive</option>
                <option value="SUSPENDED">Suspended</option>
              </select>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-2">
              <button
                onClick={exportToCSV}
                className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg transition-all border border-slate-700"
                title="Export to CSV"
              >
                <Download className="w-4 h-4" />
                Export
              </button>
              <button
                onClick={fetchStudents}
                className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg transition-all border border-slate-700"
                title="Refresh"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              </button>
              <button
                onClick={openAddModal}
                className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white rounded-lg transition-all shadow-lg"
              >
                <Plus className="w-4 h-4" />
                Add Student
              </button>
            </div>
          </div>
        </motion.div>

        {/* Table */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-slate-900/95 backdrop-blur-xl rounded-2xl border border-slate-800 shadow-2xl overflow-hidden"
        >
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader className="w-8 h-8 text-blue-400 animate-spin" />
            </div>
          ) : currentStudents.length === 0 ? (
            <div className="text-center py-20">
              <Users className="w-16 h-16 text-slate-600 mx-auto mb-4" />
              <p className="text-slate-400 text-lg">No students found</p>
              <p className="text-slate-500 text-sm mt-2">
                {searchTerm || filterStatus !== "ALL" 
                  ? "Try adjusting your search or filter" 
                  : "Add your first student to get started"}
              </p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-gradient-to-r from-blue-600 to-purple-600">
                      <th className="px-6 py-4 text-left text-xs font-semibold text-white uppercase tracking-wider">Roll No</th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-white uppercase tracking-wider">Name</th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-white uppercase tracking-wider">Email</th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-white uppercase tracking-wider">Department</th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-white uppercase tracking-wider">Year</th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-white uppercase tracking-wider">Contact</th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-white uppercase tracking-wider">Status</th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-white uppercase tracking-wider">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {currentStudents.map((student, index) => (
                      <motion.tr
                        key={student._id}
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: index * 0.05 }}
                        className="hover:bg-slate-800/50 transition-colors"
                      >
                        <td className="px-6 py-4 text-sm text-slate-300">{student.rollNo}</td>
                        <td className="px-6 py-4 text-sm text-white font-medium">{student.name}</td>
                        <td className="px-6 py-4 text-sm text-slate-300">{student.email}</td>
                        <td className="px-6 py-4 text-sm text-slate-300">{student.department}</td>
                        <td className="px-6 py-4 text-sm text-slate-300">{student.year}</td>
                        <td className="px-6 py-4 text-sm text-slate-300">{student.contactNumber}</td>
                        <td className="px-6 py-4">
                          <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
                            student.status === 'ACTIVE' ? 'bg-green-500/20 text-green-400 border border-green-500/30' :
                            student.status === 'INACTIVE' ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30' :
                            'bg-red-500/20 text-red-400 border border-red-500/30'
                          }`}>
                            {student.status}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex gap-2">
                            <button
                              onClick={() => openEditModal(student)}
                              className="p-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-all"
                              title="Edit"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => openDeleteConfirm(student)}
                              className="p-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-all"
                              title="Delete"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </motion.tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="px-6 py-4 bg-slate-800/50 border-t border-slate-800 flex items-center justify-between">
                  <div className="text-sm text-slate-400">
                    Showing {indexOfFirstStudent + 1} to {Math.min(indexOfLastStudent, filteredStudents.length)} of {filteredStudents.length} students
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                      disabled={currentPage === 1}
                      className="p-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <div className="flex gap-1">
                      {[...Array(totalPages)].map((_, i) => (
                        <button
                          key={i}
                          onClick={() => setCurrentPage(i + 1)}
                          className={`px-3 py-2 rounded-lg transition-all ${
                            currentPage === i + 1
                              ? 'bg-gradient-to-r from-blue-600 to-purple-600 text-white'
                              : 'bg-slate-700 hover:bg-slate-600 text-slate-300'
                          }`}
                        >
                          {i + 1}
                        </button>
                      ))}
                    </div>
                    <button
                      onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                      disabled={currentPage === totalPages}
                      className="p-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </motion.div>

        {/* Close students tab wrapper */}
        </div>)}

        </div>{/* end max-w-7xl */}
      </div>{/* end pt-24 */}

      {/* Add/Edit Modal */}
      <AnimatePresence>
        {showModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-slate-900 rounded-2xl border border-slate-800 shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto"
            >
              <div className="sticky top-0 bg-slate-900 border-b border-slate-800 px-6 py-4 flex justify-between items-center z-10">
                <h2 className="text-2xl font-bold bg-gradient-to-r from-blue-400 to-purple-400 text-transparent bg-clip-text">
                  {modalMode === "add" ? "Add New Student" : "Edit Student"}
                </h2>
                <button
                  onClick={() => setShowModal(false)}
                  className="p-2 hover:bg-slate-800 rounded-lg transition-all"
                >
                  <X className="w-5 h-5 text-slate-400" />
                </button>
              </div>

              <form onSubmit={handleSubmit} className="p-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Personal Information */}
                  <div className="col-span-2">
                    <h3 className="text-lg font-semibold text-purple-400 mb-4">Personal Information</h3>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">
                      Full Name <span className="text-red-400">*</span>
                    </label>
                    <input
                      type="text"
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      className={`w-full px-4 py-2 bg-slate-800 border ${formErrors.name ? 'border-red-500' : 'border-slate-700'} rounded-lg text-white focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all`}
                      placeholder="Enter full name"
                    />
                    {formErrors.name && <p className="text-red-400 text-xs mt-1">{formErrors.name}</p>}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">
                      Email <span className="text-red-400">*</span>
                    </label>
                    <input
                      type="email"
                      value={form.email}
                      onChange={(e) => setForm({ ...form, email: e.target.value })}
                      className={`w-full px-4 py-2 bg-slate-800 border ${formErrors.email ? 'border-red-500' : 'border-slate-700'} rounded-lg text-white focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all`}
                      placeholder="student@gdgu.org"
                    />
                    {formErrors.email && <p className="text-red-400 text-xs mt-1">{formErrors.email}</p>}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">
                      Date of Birth
                    </label>
                    <input
                      type="date"
                      value={form.dateOfBirth}
                      onChange={(e) => setForm({ ...form, dateOfBirth: e.target.value })}
                      className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">
                      Gender
                    </label>
                    <select
                      value={form.gender}
                      onChange={(e) => setForm({ ...form, gender: e.target.value })}
                      className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all"
                    >
                      <option value="">Select Gender</option>
                      <option value="Male">Male</option>
                      <option value="Female">Female</option>
                      <option value="Other">Other</option>
                    </select>
                  </div>

                  {/* Academic Information */}
                  <div className="col-span-2 mt-4">
                    <h3 className="text-lg font-semibold text-purple-400 mb-4">Academic Information</h3>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">
                      Roll Number <span className="text-red-400">*</span>
                    </label>
                    <input
                      type="text"
                      value={form.rollNo}
                      onChange={(e) => setForm({ ...form, rollNo: e.target.value })}
                      className={`w-full px-4 py-2 bg-slate-800 border ${formErrors.rollNo ? 'border-red-500' : 'border-slate-700'} rounded-lg text-white focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all`}
                      placeholder="Enter roll number"
                    />
                    {formErrors.rollNo && <p className="text-red-400 text-xs mt-1">{formErrors.rollNo}</p>}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">
                      Department <span className="text-red-400">*</span>
                    </label>
                    <input
                      type="text"
                      value={form.department}
                      onChange={(e) => setForm({ ...form, department: e.target.value })}
                      className={`w-full px-4 py-2 bg-slate-800 border ${formErrors.department ? 'border-red-500' : 'border-slate-700'} rounded-lg text-white focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all`}
                      placeholder="e.g., Computer Science"
                    />
                    {formErrors.department && <p className="text-red-400 text-xs mt-1">{formErrors.department}</p>}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">
                      Year <span className="text-red-400">*</span>
                    </label>
                    <select
                      value={form.year}
                      onChange={(e) => setForm({ ...form, year: e.target.value })}
                      className={`w-full px-4 py-2 bg-slate-800 border ${formErrors.year ? 'border-red-500' : 'border-slate-700'} rounded-lg text-white focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all`}
                    >
                      <option value="">Select Year</option>
                      <option value="1">1st Year</option>
                      <option value="2">2nd Year</option>
                      <option value="3">3rd Year</option>
                      <option value="4">4th Year</option>
                    </select>
                    {formErrors.year && <p className="text-red-400 text-xs mt-1">{formErrors.year}</p>}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">
                      Status
                    </label>
                    <select
                      value={form.status}
                      onChange={(e) => setForm({ ...form, status: e.target.value })}
                      className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all"
                    >
                      <option value="ACTIVE">Active</option>
                      <option value="INACTIVE">Inactive</option>
                      <option value="SUSPENDED">Suspended</option>
                    </select>
                  </div>

                  {/* Family & Contact Information */}
                  <div className="col-span-2 mt-4">
                    <h3 className="text-lg font-semibold text-purple-400 mb-4">Family & Contact Information</h3>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">
                      Father's Name <span className="text-red-400">*</span>
                    </label>
                    <input
                      type="text"
                      value={form.fatherName}
                      onChange={(e) => setForm({ ...form, fatherName: e.target.value })}
                      className={`w-full px-4 py-2 bg-slate-800 border ${formErrors.fatherName ? 'border-red-500' : 'border-slate-700'} rounded-lg text-white focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all`}
                      placeholder="Enter father's name"
                    />
                    {formErrors.fatherName && <p className="text-red-400 text-xs mt-1">{formErrors.fatherName}</p>}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">
                      Mother's Name <span className="text-red-400">*</span>
                    </label>
                    <input
                      type="text"
                      value={form.motherName}
                      onChange={(e) => setForm({ ...form, motherName: e.target.value })}
                      className={`w-full px-4 py-2 bg-slate-800 border ${formErrors.motherName ? 'border-red-500' : 'border-slate-700'} rounded-lg text-white focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all`}
                      placeholder="Enter mother's name"
                    />
                    {formErrors.motherName && <p className="text-red-400 text-xs mt-1">{formErrors.motherName}</p>}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">
                      Contact Number <span className="text-red-400">*</span>
                    </label>
                    <input
                      type="tel"
                      value={form.contactNumber}
                      onChange={(e) => setForm({ ...form, contactNumber: e.target.value })}
                      className={`w-full px-4 py-2 bg-slate-800 border ${formErrors.contactNumber ? 'border-red-500' : 'border-slate-700'} rounded-lg text-white focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all`}
                      placeholder="10-digit number"
                      maxLength={10}
                    />
                    {formErrors.contactNumber && <p className="text-red-400 text-xs mt-1">{formErrors.contactNumber}</p>}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">
                      Address
                    </label>
                    <textarea
                      value={form.address}
                      onChange={(e) => setForm({ ...form, address: e.target.value })}
                      className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all"
                      placeholder="Enter address"
                      rows={3}
                    />
                  </div>
                </div>

                {/* Form Actions */}
                <div className="flex gap-4 mt-6 pt-6 border-t border-slate-800">
                  <button
                    type="button"
                    onClick={() => setShowModal(false)}
                    className="flex-1 px-6 py-3 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-all"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={loading}
                    className="flex-1 px-6 py-3 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white rounded-lg transition-all shadow-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {loading ? (
                      <>
                        <Loader className="w-5 h-5 animate-spin" />
                        Processing...
                      </>
                    ) : (
                      modalMode === "add" ? "Add Student" : "Update Student"
                    )}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {showDeleteConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-slate-900 rounded-2xl border border-slate-800 shadow-2xl w-full max-w-md p-6"
            >
              <div className="flex items-center gap-4 mb-4">
                <div className="p-3 bg-red-500/20 rounded-full">
                  <AlertCircle className="w-6 h-6 text-red-400" />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-white">Confirm Delete</h3>
                  <p className="text-slate-400 text-sm">This action cannot be undone</p>
                </div>
              </div>

              <p className="text-slate-300 mb-6">
                Are you sure you want to delete <span className="font-semibold text-white">{studentToDelete?.name}</span>?
                <br />
                <span className="text-sm text-slate-400">Roll No: {studentToDelete?.rollNo}</span>
              </p>

              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setShowDeleteConfirm(false);
                    setStudentToDelete(null);
                  }}
                  className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDelete}
                  disabled={loading}
                  className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {loading ? (
                    <>
                      <Loader className="w-4 h-4 animate-spin" />
                      Deleting...
                    </>
                  ) : (
                    <>
                      <Trash2 className="w-4 h-4" />
                      Delete
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Chatbot Widget */}
      <Chatbot />
    </div>
  );
}
